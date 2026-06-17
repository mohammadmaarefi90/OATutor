import { cleanArray } from "../util/cleanObject.js";
import { AGENT_TYPES } from "./agentTypes.js";
import BaseAgent from "./BaseAgent.js";
import AgentPerformanceTracker from "./AgentPerformanceTracker.js";
import ReasoningGraph from "./ReasoningGraph.js";
import { completeChat } from "./llm/llmClient.js";
import { getLLMSettingsSync, PROP_HINT_MODES } from "./llm/llmSettings.js";
import {
    attachKnowledgeComponents,
    computePropLessonMastery,
    computePropositionMasterySummary,
    createAgentPropBKTEngine,
    buildPromptPropositionBundle,
    POLICY_VERSION,
    PropositionBKTEngine,
    exportPropBeliefGraph,
} from "./llm/propositionBKTBridge.js";
import {
    buildPropHintPrompt,
    resolvePropHintMode,
} from "./llm/beliefRetrieval.js";
import {
    AGENT_PERFORMANCE_STORAGE_KEY,
    AGENT_REASONING_STORAGE_KEY,
    AGENT_PROP_BKT_STORAGE_KEY,
} from "./storageKeys.js";
import {
    buildLLMAfterSnapshot,
    buildLLMStepSnapshot,
    getExpectedAnswerDisplay,
} from "./llm/llmStepTrace.js";
import {
    buildStepPlan,
    formatStepPlanForPrompt,
    isPropPlanningEnabled,
    summarizePlanForEvent,
    PROP_PLANNING_MODE,
} from "./llm/propositionHintPlanner.js";
import {
    isFullPathwayTrainingMode,
    resolvePropTrainingHintMode,
    resolveTrainingAnswer,
    selectNextTrainingHint,
    summarizeTrainingRevealForEvent,
    TRAINING_PATH_VERSION,
} from "./llm/propositionTrainingPath.js";

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export default class LocalPropositionalLLMAgent extends BaseAgent {
    constructor(options) {
        const agentType = options.agentType || AGENT_TYPES.LOCAL_LLM_PROP;
        super({ ...options, agentType });
        this.skillModel = options.skillModel || {};
        this.problems = attachKnowledgeComponents(this.problems, this.skillModel);
        this.performance = new AgentPerformanceTracker(this.lesson.id, agentType);
        this.reasoningGraph = new ReasoningGraph(this.lesson.id, agentType);
        this.propEngine = createAgentPropBKTEngine();
        this._ingestedLesson = false;
        this.llmCalls = 0;
        this.llmSuccesses = 0;
        this.llmFallbacks = 0;
        this.propEventsProcessed = 0;
        this._evaluationMode = false;
        this._currentStepPolicy = null;
        this._currentHintRetrieval = null;
        this._currentStepPlan = null;
        this.llmSettings = options.llmSettings || getLLMSettingsSync();
    }

    getReasoningGraph() {
        return this.reasoningGraph;
    }

    async saveReasoningGraph() {
        if (!this._persist) return;
        await this._persist.setByKey(
            AGENT_REASONING_STORAGE_KEY(this.lesson.id, this.agentType),
            this.reasoningGraph.toJSON()
        );
    }

    _ensureLessonIngested() {
        if (this._ingestedLesson) return;
        this.propEngine.ingestLesson({
            lessonId: this.lesson.id,
            problems: this.problems,
            skillModel: this.skillModel,
        });
        this._ingestedLesson = true;
    }

    async loadPersistedState() {
        if (!this.browserStorage) {
            this._ensureLessonIngested();
            return;
        }
        const { getByKey, setByKey } = this.browserStorage;
        const type = this.agentType;
        const [perfData, reasoningData, propData] = await Promise.all([
            getByKey(AGENT_PERFORMANCE_STORAGE_KEY(this.lesson.id, type)).catch(() => null),
            getByKey(AGENT_REASONING_STORAGE_KEY(this.lesson.id, type)).catch(() => null),
            getByKey(AGENT_PROP_BKT_STORAGE_KEY(this.lesson.id, type)).catch(() => null),
        ]);
        if (AgentPerformanceTracker.fromJSON(perfData)) {
            this.performance = AgentPerformanceTracker.fromJSON(perfData);
        }
        if (ReasoningGraph.fromJSON(reasoningData)) {
            this.reasoningGraph = ReasoningGraph.fromJSON(reasoningData);
        }
        if (propData) {
            this.propEngine = PropositionBKTEngine.fromJSON(propData);
            this._ingestedLesson = true;
        } else {
            this._ensureLessonIngested();
        }
        this._persist = { getByKey, setByKey };
    }

    async savePersistedState() {
        if (!this._persist || this._evaluationMode) return;
        const type = this.agentType;
        await Promise.all([
            this._persist.setByKey(
                AGENT_PERFORMANCE_STORAGE_KEY(this.lesson.id, type),
                this.performance.toJSON()
            ),
            this._persist.setByKey(
                AGENT_REASONING_STORAGE_KEY(this.lesson.id, type),
                this.reasoningGraph.toJSON()
            ),
            this._persist.setByKey(
                AGENT_PROP_BKT_STORAGE_KEY(this.lesson.id, type),
                this.propEngine.toJSON()
            ),
        ]);
    }

    _lessonMastery() {
        return computePropLessonMastery(this.lesson, this.propEngine);
    }

    _updateBKT(_kcArray, _isCorrect) {
        const mastery = this._lessonMastery();
        this.onMasteryUpdate(mastery);
        return mastery;
    }

    getMemoryStats() {
        const beliefs = this.propEngine.getBeliefs();
        return {
            entryCount: Object.keys(beliefs).length,
            avgStrength: 0,
            llmCalls: this.llmCalls,
            propEventsProcessed: this.propEventsProcessed,
        };
    }

    getGraphStats() {
        const structure = this.propEngine.structureGraphs[this.lesson.id];
        const behavioral = this.propEngine.behavioralGraphs[this.lesson.id];
        return {
            nodeCount: structure ? Object.keys(structure.nodes || {}).length : 0,
            edgeCount: structure?.edges?.length || 0,
            behavioralEdges: behavioral
                ? Object.keys(behavioral.transitionCounts || {}).length
                : 0,
        };
    }

    getGrowthSummary() {
        return this.performance.getGrowthSummary();
    }

    createRun() {
        const run = this.performance.startRun();
        run.agentType = this.agentType;
        run.bktMode = "proposition";
        this.llmCalls = 0;
        this.llmSuccesses = 0;
        this.llmFallbacks = 0;
        this.propEventsProcessed = 0;
        return run;
    }

    finalizeRun(run, reason) {
        run.llmCalls = this.llmCalls;
        run.llmSuccesses = this.llmSuccesses;
        run.llmFallbacks = this.llmFallbacks;
        run.propEventsProcessed = this.propEventsProcessed;
        run.propMastery = this._lessonMastery();
        run.propAnswerMastery = computePropositionMasterySummary(this.propEngine);
        run.propHintRetrieval = resolvePropHintMode(this.llmSettings || getLLMSettingsSync());
        run.endedAt = Date.now();
        run.status = reason;
        run.durationMs = run.endedAt - run.startedAt;
        this.performance.finalizeRun(run, reason);
    }

    _processPropEvent(event) {
        this._ensureLessonIngested();
        const result = this.propEngine.processEvent(event);
        this.propEventsProcessed += 1;
        return result;
    }

    _processPropHintReveal(step, hint, pathwayIndex) {
        return this._processPropEvent({
            type: "hint_reveal",
            stepId: step.id,
            hintId: hint.id,
            pathwayIndex,
        });
    }

    _processPropAttempt(step, problem, { correct, firstTry }) {
        return this._processPropEvent({
            type: "attempt",
            stepId: step.id,
            problemId: problem.id,
            correct,
            firstTry,
        });
    }

    _getPropBeliefDeltas() {
        return this.propEngine.getBeliefDeltas();
    }

    _isPlanningEnabled() {
        const settings = getLLMSettingsSync();
        this.llmSettings = settings;
        return isPropPlanningEnabled(settings, this.agentType);
    }

    _buildStepPlan(step) {
        const settings = getLLMSettingsSync();
        this.llmSettings = settings;
        return buildStepPlan(this.propEngine, {
            lessonId: this.lesson.id,
            stepId: step.id,
            settings,
            reasoningGraph: this.reasoningGraph,
        });
    }

    _applyStepPlan(step, settings) {
        try {
            this._currentStepPlan = this._buildStepPlan(step);
            this._emit("prop-plan", summarizePlanForEvent(this._currentStepPlan, {
                agentType: this.agentType,
                strictNoClues: this._strictNoClues,
            }));
            this._emit("hint-retrieval", {
                stepId: step.id,
                agentType: this.agentType,
                hintRetrievalMode: PROP_PLANNING_MODE,
                hintRetrievalLabel: "Hint planning (trained beliefs)",
            });
            return true;
        } catch (err) {
            console.error("Hint planning failed; falling back to proposition hints", err);
            this._currentStepPlan = null;
            this._currentHintRetrieval = buildPropHintPrompt(this.propEngine, {
                lessonId: this.lesson.id,
                stepId: step.id,
                settings,
            });
            this._emit("llm-error", {
                stepId: step.id,
                message: `Hint planning failed (${err.message || "unknown"}); using standard hint retrieval.`,
            });
            this._emit("hint-retrieval", {
                stepId: step.id,
                agentType: this.agentType,
                hintRetrievalMode: this._currentHintRetrieval.mode,
                hintRetrievalLabel: this._currentHintRetrieval.modeLabel,
            });
            return false;
        }
    }

    _buildStepPolicy(step) {
        const settings = this.llmSettings || getLLMSettingsSync();
        const mode = resolvePropHintMode(settings);
        if (mode === PROP_HINT_MODES.RELEVANCE) {
            return buildPromptPropositionBundle(this.propEngine, {
                lessonId: this.lesson.id,
                stepId: step.id,
                settings,
            });
        }
        return null;
    }

    _buildMessages(step, problem) {
        const settings = this.llmSettings || getLLMSettingsSync();
        const skills = cleanArray(step.knowledgeComponents || []);

        if (this._currentStepPlan) {
            const plan = this._currentStepPlan;
            const promptBlock = formatStepPlanForPrompt(plan);
            this._currentHintRetrieval = {
                mode: PROP_PLANNING_MODE,
                modeLabel: "Hint planning (trained beliefs)",
                promptBlock,
                plan,
            };

            const systemContent =
                "You are a math tutoring agent solving without live hints. " +
                "Use the hint plan below: pivot ideas show what to think about, relevant hints summarize " +
                "training knowledge, and candidate chains show ordered reasoning paths. " +
                "Respond with ONLY the final answer in LaTeX wrapped in $$...$$ with no explanation.";

            const userContent =
                `Hint plan (skills: ${skills.join(", ") || "general"}):\n` +
                `${promptBlock}\n\n` +
                `Problem title: ${problem.title || ""}\n` +
                `Problem body: ${problem.body || ""}\n` +
                `Step: ${step.stepTitle || ""}\n` +
                `Step body: ${step.stepBody || ""}\n\n` +
                "Final answer:";

            return [
                { role: "system", content: systemContent },
                { role: "user", content: userContent },
            ];
        }

        const retrieval =
            this._currentHintRetrieval ||
            buildPropHintPrompt(this.propEngine, {
                lessonId: this.lesson.id,
                stepId: step.id,
                settings,
            });
        this._currentHintRetrieval = retrieval;

        const isRelevance = retrieval.mode === PROP_HINT_MODES.RELEVANCE;
        const systemContent = isRelevance
            ? "You are a math tutoring agent. Prioritize the Suggested focus proposition. " +
              "Use Ideas to strengthen as missing reasoning steps. Known anchors are ideas you likely already know. " +
              "Each line shows P(know) from proposition-BKT. " +
              "Respond with ONLY the final answer in LaTeX wrapped in $$...$$ with no explanation."
            : "You are a math tutoring agent. Use the proposition beliefs below when relevant. " +
              "Each line shows P(know). Respond with ONLY the final answer in LaTeX wrapped in $$...$$ with no explanation.";

        const userContent =
            `Proposition hints (skills: ${skills.join(", ") || "general"}, retrieval: ${retrieval.modeLabel}):\n` +
            `${retrieval.promptBlock}\n\n` +
            `Problem title: ${problem.title || ""}\n` +
            `Problem body: ${problem.body || ""}\n` +
            `Step: ${step.stepTitle || ""}\n` +
            `Step body: ${step.stepBody || ""}\n\n` +
            "Final answer:";

        return [
            { role: "system", content: systemContent },
            { role: "user", content: userContent },
        ];
    }

    async _queryLLM(step, problem) {
        this.llmCalls += 1;
        this.llmSettings = getLLMSettingsSync();
        const settings = this.llmSettings;

        try {
            const result = await completeChat(this._buildMessages(step, problem), { settings });
            let parsedAttempt = result.answer || null;
            if (!parsedAttempt && result.rawText) {
                parsedAttempt = result.rawText.trim().split("\n").pop()?.trim() || null;
            }
            if (parsedAttempt) this.llmSuccesses += 1;
            return {
                parsedAttempt,
                answer: parsedAttempt,
                content: result.content,
                rawText: result.rawText,
                reasoning: result.reasoning,
                provider: result.provider || "local-gpt-oss",
            };
        } catch (err) {
            this._recordReasoningAction("llm-error", err.message?.slice(0, 80) || "error");
            this._emit("llm-error", { stepId: step.id, message: err.message });
            return {
                parsedAttempt: null,
                error: err.message,
                provider: "local-gpt-oss",
            };
        }
    }

    _traceHintPathway(_step) {
        /* Hint reveals emitted in _learnFromHints with proposition-BKT events. */
    }

    _revealTrainingHint(step, hint, pathwayIndex) {
        this._processPropHintReveal(step, hint, pathwayIndex);
        if (this.reasoningSession) {
            this.reasoningSession.visitHint(hint, step.id, pathwayIndex);
        }
    }

    /** Hook for Chain agent to record partial pathway chains. */
    _onTrainingHintRevealed(step, hint, pathwayIndex, selection, revealedPathway) {
        void step;
        void hint;
        void pathwayIndex;
        void selection;
        void revealedPathway;
    }

    _onTrainingPathwayComplete(step, revealedPathway) {
        void step;
        void revealedPathway;
    }

    async _learnFromHintsFullPathway(step, problem, seed, run, pathway) {
        run.hintsConsumed += pathway.length;

        for (let i = 0; i < pathway.length; i++) {
            const hint = pathway[i];
            this._revealTrainingHint(step, hint, i);
            this._onTrainingHintRevealed(step, hint, i, { reason: "full-pathway" }, pathway.slice(0, i + 1));
            await sleep(this.stepDelayMs / 3);
            if (this.cancelled) return null;
        }

        this._onTrainingPathwayComplete(step, pathway);
        const settings = this.llmSettings || getLLMSettingsSync();
        const learned = this._getAnswerFromHints(pathway);
        return (
            learned?.answer ||
            (settings.propTrainingAllowAnswerKey !== false ? step.stepAnswer?.[0] : null) ||
            null
        );
    }

    async _learnFromHintsWritePath(step, problem, seed, run) {
        const settings = this.llmSettings || getLLMSettingsSync();
        const pathway = this._resolveHintPathway(step);
        const revealed = new Set();
        const maxHints = settings.propTrainingMaxHintsPerStep ?? 8;
        const retryLlm = settings.propTrainingRetryLlm !== false;
        let attempt = null;
        let hintsRevealed = 0;

        this._emit("prop-training-start", {
            stepId: step.id,
            trainingMode: resolvePropTrainingHintMode(settings),
            trainingPathVersion: TRAINING_PATH_VERSION,
            pathwayLength: pathway.length,
            retryLlm,
        });

        while (hintsRevealed < maxHints && revealed.size < pathway.length) {
            if (this.cancelled) return attempt;

            const selection = selectNextTrainingHint(this.propEngine, {
                lessonId: this.lesson.id,
                stepId: step.id,
                pathway,
                revealedHintIds: revealed,
                settings,
            });
            if (!selection?.hint) break;

            const { hint, pathwayIndex } = selection;
            this._revealTrainingHint(step, hint, pathwayIndex);
            revealed.add(hint.id);
            hintsRevealed += 1;
            run.hintsConsumed += 1;

            const revealedPathway = pathway.filter((h) => revealed.has(h.id));
            this._onTrainingHintRevealed(step, hint, pathwayIndex, selection, revealedPathway);
            this._emit("prop-training-hint", {
                stepId: step.id,
                ...summarizeTrainingRevealForEvent(selection, { hintsRevealedTotal: hintsRevealed }),
            });

            if (isPropPlanningEnabled(settings, this.agentType)) {
                this._applyStepPlan(step, settings);
            }

            await sleep(this.stepDelayMs / 3);
            if (this.cancelled) return attempt;

            if (!retryLlm) continue;

            const llmResult = await this._queryLLM(step, problem);
            attempt = llmResult?.parsedAttempt ?? null;
            const retryCorrect = attempt ? this._checkStepAnswer(step, attempt, seed) : false;

            this._emit("prop-training-retry", {
                stepId: step.id,
                attempt: attempt?.slice(0, 120) || null,
                isCorrect: retryCorrect,
                hintsRevealed,
            });

            if (retryCorrect) {
                this._recordReasoningAction("llm-response", attempt.slice(0, 50));
                this._emit("llm-response", {
                    stepId: step.id,
                    attempt,
                    rawText: llmResult?.rawText,
                    reasoning: llmResult?.reasoning,
                    content: llmResult?.content,
                    provider: "local-gpt-oss",
                    source: "prop-training-retry",
                });
                this._onTrainingPathwayComplete(step, revealedPathway);
                return attempt;
            }
        }

        const revealedPathway = pathway.filter((h) => revealed.has(h.id));
        this._onTrainingPathwayComplete(step, revealedPathway);

        const fromHints = resolveTrainingAnswer(pathway, revealed, step, settings);
        if (fromHints) return fromHints;

        return attempt;
    }

    async _learnFromHints(step, problem, seed, run) {
        const settings = this.llmSettings || getLLMSettingsSync();
        const pathway = this._resolveHintPathway(step);

        if (isFullPathwayTrainingMode(settings)) {
            return this._learnFromHintsFullPathway(step, problem, seed, run, pathway);
        }

        return this._learnFromHintsWritePath(step, problem, seed, run);
    }

    async _solveStep(step, problem, seed, run) {
        const skills = cleanArray(step.knowledgeComponents || []);
        run.stepsTotal += 1;

        this._ensureLessonIngested();
        this._processPropEvent({
            type: "session_start",
            stepId: step.id,
            problemId: problem.id,
        });

        this._currentStepPolicy = this._buildStepPolicy(step);
        const settings = this.llmSettings || getLLMSettingsSync();
        this.llmSettings = settings;

        const planningRequested = isPropPlanningEnabled(settings, this.agentType);
        if (planningRequested) {
            this._applyStepPlan(step, settings);
        } else {
            this._currentStepPlan = null;
            this._currentHintRetrieval = buildPropHintPrompt(this.propEngine, {
                lessonId: this.lesson.id,
                stepId: step.id,
                settings,
            });
        }

        this._startStepReasoning(step, problem);
        this._emit("step-start", { stepId: step.id, problemId: problem.id, skills });
        if (!planningRequested) {
            this._emit("hint-retrieval", {
                stepId: step.id,
                agentType: this.agentType,
                hintRetrievalMode: this._currentHintRetrieval.mode,
                hintRetrievalLabel: this._currentHintRetrieval.modeLabel,
            });
        }
        if (this._currentStepPolicy && !this._currentStepPlan) {
            this._emit("prop-policy", {
                stepId: step.id,
                policyVersion: POLICY_VERSION,
                hintRetrievalMode: this._currentHintRetrieval.mode,
                primarySuggestion: this._currentStepPolicy?.primarySuggestion,
                suggestions: (this._currentStepPolicy?.suggestions || []).map((p) => ({
                    id: p.id,
                    text: p.text?.slice(0, 200),
                    probMastery: p.probMastery,
                    priority: p.priority,
                })),
                closureSize: this._currentStepPolicy?.closureSize,
            });
        }

        let attempt = null;
        let firstTry = false;
        let source = "none";
        let llmBefore = null;
        let llmAfter = null;
        let usedHints = false;
        let finalAttemptAfter = null;

        this._recordReasoningAction(
            "llm-query",
            this._evaluationMode
                ? "local LLM + proposition beliefs"
                : "local reasoning LLM (prop BKT)"
        );
        const llmResult = await this._queryLLM(step, problem);
        attempt = llmResult?.parsedAttempt ?? null;
        const llmCorrectBefore = attempt ? this._checkStepAnswer(step, attempt, seed) : false;
        llmBefore = buildLLMStepSnapshot(llmResult, { correct: llmCorrectBefore });

        if (attempt) {
            firstTry = true;
            source = "local-llm-prop";
            this._recordReasoningAction("llm-response", attempt.slice(0, 50));
            this._emit("llm-response", {
                stepId: step.id,
                attempt,
                rawText: llmBefore?.rawText,
                reasoning: llmBefore?.reasoning,
                content: llmBefore?.content,
                provider: "local-gpt-oss",
            });
        }

        let isCorrect = attempt ? this._checkStepAnswer(step, attempt, seed) : false;
        finalAttemptAfter = attempt;

        this._processPropAttempt(step, problem, { correct: isCorrect, firstTry: true });

        if (!isCorrect && this._shouldAllowHints()) {
            firstTry = false;
            this.llmFallbacks += 1;
            usedHints = true;

            attempt = await this._learnFromHints(step, problem, seed, run);
            finalAttemptAfter = attempt;
            source = this._evaluationMode ? "test-hint-fallback" : "train-hint-fallback";
            this._recordReasoningAction("hint-fallback", source);
            if (attempt) isCorrect = this._checkStepAnswer(step, attempt, seed);

            this._processPropAttempt(step, problem, { correct: isCorrect, firstTry: false });
        } else if (!isCorrect && this._strictNoClues) {
            firstTry = false;
            source = "strict-no-clue";
            this._processPropAttempt(step, problem, { correct: false, firstTry: false });
        }

        this._processPropEvent({ type: "session_end", stepId: step.id });

        const propBeliefDeltas = this._getPropBeliefDeltas();

        llmAfter = buildLLMAfterSnapshot({
            attempt: finalAttemptAfter,
            correct: isCorrect,
            usedHints,
            source,
        });

        if (isCorrect) {
            if (firstTry) run.stepsCorrectFirstTry += 1;
            else run.stepsCorrectAfterLearning += 1;
            this._updateBKT(skills, true);
        } else {
            this._updateBKT(skills, false);
        }

        this._recordReasoningAnswer(attempt, isCorrect);
        this._emit("step-complete", {
            stepId: step.id,
            isCorrect,
            firstTry,
            attempt,
            source,
            llmBefore,
            llmAfter,
            expectedAnswer: getExpectedAnswerDisplay(step, seed),
            propBeliefDeltas,
            propPolicySuggestion:
                this._currentStepPlan?.pivots?.[0]
                    ? {
                          id: this._currentStepPlan.pivots[0].id,
                          text: this._currentStepPlan.pivots[0].text,
                          probMastery: this._currentStepPlan.pivots[0].probMastery,
                          reason: "hint-plan pivot",
                      }
                    : this._currentStepPolicy?.primarySuggestion || null,
            policyVersion: this._isPlanningEnabled()
                ? this._currentStepPlan?.planVersion
                : POLICY_VERSION,
            hintPlanning: this._isPlanningEnabled(),
            planVersion: this._currentStepPlan?.planVersion || null,
            hintRetrievalMode: this._currentHintRetrieval?.mode,
            hintRetrievalLabel: this._currentHintRetrieval?.modeLabel,
            bktMode: "proposition",
            strictNoClues: this._strictNoClues,
        });
        this._currentStepPolicy = null;
        this._currentStepPlan = null;
        this._currentHintRetrieval = null;
        await sleep(this.stepDelayMs);
        return isCorrect;
    }

    async _solveProblem(problem, run) {
        const seed = Date.now().toString();
        run.problemsAttempted += 1;

        this._emit("problem-start", {
            problemId: problem.id,
            title: problem.title,
            stepCount: problem.steps.length,
        });

        for (const step of problem.steps) {
            if (this.cancelled) return false;
            await this._solveStep(step, problem, seed, run);
        }

        run.problemsCompleted += 1;
        this.completedProbs.add(problem.id);
        this._emit("problem-complete", { problemId: problem.id });
        return true;
    }

    async evaluateProblem(problem, options = {}) {
        const persistLearning = options.persistLearning !== false;
        this._evaluationMode = !persistLearning;
        await this.loadPersistedState?.();
        const engineSnapshot = this.propEngine.toJSON();
        try {
            const result = await super.evaluateProblem(problem, options);
            return { ...result, bktMode: "proposition" };
        } finally {
            if (!persistLearning) {
                this.propEngine = PropositionBKTEngine.fromJSON(engineSnapshot);
            }
            this._evaluationMode = false;
        }
    }

    buildOutput(run) {
        const output = super.buildOutput(run);
        return {
            ...output,
            bktMode: "proposition",
            propMastery: this._lessonMastery(),
            propAnswerMastery: computePropositionMasterySummary(this.propEngine),
            agentExtras: this.getAgentExtras?.() || output.agentExtras,
        };
    }

    getAgentExtras() {
        const settings = this.llmSettings || getLLMSettingsSync();
        const propAnswerMastery = computePropositionMasterySummary(this.propEngine);
        return {
            strategy: "local-reasoning-llm-propositional-bkt",
            bktMode: "proposition",
            policyVersion: POLICY_VERSION,
            propHintRetrieval: resolvePropHintMode(settings),
            propPlanningEnabled: this._isPlanningEnabled(),
            propTrainingHintMode: resolvePropTrainingHintMode(settings),
            propTrainingRetryLlm: settings.propTrainingRetryLlm !== false,
            trainingPathVersion: TRAINING_PATH_VERSION,
            provider: settings.provider,
            localBaseUrl: settings.localBaseUrl,
            localModel: settings.localModel,
            reasoningEffort: settings.reasoningEffort,
            llmCalls: this.llmCalls,
            llmSuccesses: this.llmSuccesses,
            llmFallbacks: this.llmFallbacks,
            propMastery: this._lessonMastery(),
            propAnswerMastery,
            propEventsProcessed: this.propEventsProcessed,
            beliefGraph: exportPropBeliefGraph(this.propEngine, this.lesson.id),
        };
    }
}
