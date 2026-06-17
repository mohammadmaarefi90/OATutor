import { cleanArray } from "../util/cleanObject.js";
import { AGENT_TYPES } from "./agentTypes.js";
import LocalPropositionalLLMAgent from "./LocalPropositionalLLMAgent.js";
import ChainReasoningStore from "./llm/chainReasoningStore.js";
import {
    AGENT_CHAIN_REASONING_STORAGE_KEY,
    AGENT_PERFORMANCE_STORAGE_KEY,
    AGENT_PROP_BKT_STORAGE_KEY,
    AGENT_REASONING_STORAGE_KEY,
} from "./storageKeys.js";
import {
    buildChainsForStep,
    chainFromHintPathway,
    CHAIN_POLICY_VERSION,
    formatChainEvalSummary,
    formatChainForPrompt,
    recordChainTransitions,
} from "./llm/propositionChainReasoning.js";
import {
    buildLLMAfterSnapshot,
    buildLLMStepSnapshot,
    getExpectedAnswerDisplay,
} from "./llm/llmStepTrace.js";
import { POLICY_VERSION } from "./llm/propositionBKTBridge.js";

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export default class LocalPropositionalChainLLMAgent extends LocalPropositionalLLMAgent {
    constructor(options) {
        super({ ...options, agentType: AGENT_TYPES.LOCAL_LLM_PROP_CHAIN });
        this.chainStore = new ChainReasoningStore(this.lesson.id);
        this._currentChainContext = null;
        this._maxChainAttempts = 4;
        this.chainsEvaluated = 0;
        this.chainSuccesses = 0;
    }

    async loadPersistedState() {
        await super.loadPersistedState();
        if (!this.browserStorage) return;
        const chainData = await this.browserStorage
            .getByKey(AGENT_CHAIN_REASONING_STORAGE_KEY(this.lesson.id, this.agentType))
            .catch(() => null);
        if (ChainReasoningStore.fromJSON(chainData)) {
            this.chainStore = ChainReasoningStore.fromJSON(chainData);
        }
    }

    async savePersistedState() {
        await super.savePersistedState();
        if (!this._persist || this._evaluationMode) return;
        await this._persist.setByKey(
            AGENT_CHAIN_REASONING_STORAGE_KEY(this.lesson.id, this.agentType),
            this.chainStore.toJSON()
        );
    }

    createRun() {
        const run = super.createRun();
        run.bktMode = "proposition-chain";
        this.chainsEvaluated = 0;
        this.chainSuccesses = 0;
        return run;
    }

    finalizeRun(run, reason) {
        super.finalizeRun(run, reason);
        run.chainsEvaluated = this.chainsEvaluated;
        run.chainSuccesses = this.chainSuccesses;
        run.bktMode = "proposition-chain";
    }

    _buildChainContext(step) {
        return buildChainsForStep(this.propEngine, {
            lessonId: this.lesson.id,
            stepId: step.id,
            chainStore: this.chainStore,
            reasoningGraph: this.reasoningGraph,
            maxChains: 8,
        });
    }

    _getChainBktMode() {
        return "proposition-chain";
    }

    _getChainPolicyVersion() {
        return CHAIN_POLICY_VERSION;
    }

    _emitChainCandidates(step, chainContext) {
        this._emit("prop-chain-candidates", {
            stepId: step.id,
            agentType: this.agentType,
            policyVersion: CHAIN_POLICY_VERSION,
            strictNoClues: this._strictNoClues || this._evaluationMode,
            chains: (chainContext.chains || []).map((c) => ({
                key: c.key,
                score: c.score,
                length: c.length,
                nodes: c.nodes?.map((n) => ({
                    id: n.id,
                    text: n.text?.slice(0, 120),
                    probMastery: n.probMastery,
                })),
            })),
            primaryChainKey: chainContext.primaryChain?.key || null,
        });
    }

    _buildMessages(step, problem) {
        const skills = cleanArray(step.knowledgeComponents || []);
        const chain = this._currentChainContext?.selectedChain;
        const chainBlock = formatChainForPrompt(chain, {
            phaseLabel: this._evaluationMode
                ? "Evaluate this reasoning chain (no hints)"
                : "Follow this reasoning chain",
        });

        const systemContent =
            "You are a math tutoring agent solving one step at a time. " +
            "Work through the ordered reasoning chain from first idea to conclusion. " +
            "Each line shows P(know) for that proposition. " +
            "Respond with ONLY the final answer in LaTeX wrapped in $$...$$ with no explanation.";

        const userContent =
            `Reasoning chain policy (${CHAIN_POLICY_VERSION}, skills: ${skills.join(", ") || "general"}):\n` +
            `${chainBlock}\n\n` +
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

    async _tryChain(step, problem, seed, chain, attemptIndex) {
        this._currentChainContext = {
            ...this._currentChainContext,
            selectedChain: chain,
            attemptIndex,
        };

        this._recordReasoningAction(
            "chain-eval",
            `chain ${attemptIndex + 1}/${this._currentChainContext.chains.length} score=${(chain.score || 0).toFixed(2)}`
        );

        const llmResult = await this._queryLLM(step, problem);
        const attempt = llmResult?.parsedAttempt ?? null;
        const isCorrect = attempt ? this._checkStepAnswer(step, attempt, seed) : false;

        this.chainsEvaluated += 1;
        if (isCorrect) this.chainSuccesses += 1;

        const evalSummary = formatChainEvalSummary({
            chain,
            reachedConclusion: isCorrect,
            attempt,
        });

        this._emit("prop-chain-eval", {
            stepId: step.id,
            attemptIndex,
            chainKey: chain.key,
            chainScore: chain.score,
            chainLength: chain.length,
            reachedConclusion: isCorrect,
            attempt,
            evalSummary,
            strictNoClues: this._strictNoClues || this._evaluationMode,
        });

        return {
            attempt,
            isCorrect,
            llmResult,
            chain,
            evalSummary,
        };
    }

    _recordPartialPathwayChain(step, revealedPathway, { source = "hint-pathway", finalize = false } = {}) {
        const structure = this.propEngine.structureGraphs[this.lesson.id];
        const stepContent = this.propEngine.stepContent?.[step.id];
        const hintChainIds = chainFromHintPathway(structure, revealedPathway, stepContent);

        if (hintChainIds.length === 0) return;

        recordChainTransitions(this.reasoningGraph, hintChainIds, {
            type: "prop-chain",
            action: source,
            stepId: step.id,
        });

        if (!finalize) return;

        this.chainStore.rememberStepChain(step.id, hintChainIds);
        if (!this._evaluationMode) {
            this.chainStore.recordOutcome(hintChainIds, true);
        }
        this._emit("prop-chain-learned", {
            stepId: step.id,
            chainKey: hintChainIds.join("→"),
            propIds: hintChainIds,
            source,
            hintsInPath: revealedPathway.length,
        });
    }

    _onTrainingHintRevealed(step, _hint, _pathwayIndex, selection, revealedPathway) {
        const source =
            selection?.reason === "full-pathway" ? "hint-pathway" : "hint-pathway-partial";
        this._recordPartialPathwayChain(step, revealedPathway, { source, finalize: false });
    }

    _onTrainingPathwayComplete(step, revealedPathway) {
        this._recordPartialPathwayChain(step, revealedPathway, {
            source: "hint-pathway-complete",
            finalize: true,
        });
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

        const chainContext = this._buildChainContext(step);
        this._currentChainContext = chainContext;
        this._currentStepPolicy = this._buildStepPolicy(step);

        this._startStepReasoning(step, problem);
        this._emit("step-start", { stepId: step.id, problemId: problem.id, skills });
        this._emitChainCandidates(step, chainContext);

        let attempt = null;
        let firstTry = false;
        let source = "none";
        let llmBefore = null;
        let llmAfter = null;
        let usedHints = false;
        let finalAttemptAfter = null;
        let chainUsed = null;
        let chainCandidates = chainContext.chains?.length || 0;
        const chainsTried = [];

        const chainsToTry = (chainContext.chains || []).slice(0, this._maxChainAttempts);
        if (chainsToTry.length === 0 && chainContext.primaryChain) {
            chainsToTry.push(chainContext.primaryChain);
        }

        let isCorrect = false;
        let llmResult = null;

        for (let i = 0; i < chainsToTry.length; i++) {
            if (this.cancelled) break;
            const chain = chainsToTry[i];
            const result = await this._tryChain(step, problem, seed, chain, i);
            chainsTried.push({
                key: chain.key,
                score: chain.score,
                reachedConclusion: result.isCorrect,
            });

            if (i === 0) {
                llmBefore = buildLLMStepSnapshot(result.llmResult, { correct: result.isCorrect });
            }

            if (result.attempt) {
                attempt = result.attempt;
                finalAttemptAfter = attempt;
                chainUsed = chain;
                this._emit("llm-response", {
                    stepId: step.id,
                    attempt,
                    rawText: result.llmResult?.rawText,
                    reasoning: result.llmResult?.reasoning,
                    content: result.llmResult?.content,
                    provider: "local-gpt-oss",
                    chainKey: chain.key,
                });
            }

            if (result.isCorrect) {
                isCorrect = true;
                firstTry = true;
                source = this._evaluationMode ? "prop-chain-eval" : "prop-chain-train";
                if (!this._evaluationMode) {
                    this.chainStore.recordOutcome(chain.propIds, true);
                    recordChainTransitions(this.reasoningGraph, chain.propIds, {
                        type: "prop-chain",
                        action: "success",
                        stepId: step.id,
                    });
                    this.chainStore.rememberStepChain(step.id, chain.propIds);
                }
                break;
            }
        }

        if (!isCorrect && !this._evaluationMode && this._shouldAllowHints()) {
            firstTry = false;
            this.llmFallbacks += 1;
            usedHints = true;

            if (chainUsed) {
                this.chainStore.recordOutcome(chainUsed.propIds, false);
            }

            attempt = await this._learnFromHints(step, problem, seed, run);
            finalAttemptAfter = attempt;
            source = "train-hint-fallback";
            this._recordReasoningAction("hint-fallback", source);
            if (attempt) isCorrect = this._checkStepAnswer(step, attempt, seed);

            this._processPropAttempt(step, problem, { correct: isCorrect, firstTry: false });
        } else if (isCorrect) {
            this._processPropAttempt(step, problem, { correct: true, firstTry });
        } else {
            this._processPropAttempt(step, problem, { correct: false, firstTry: false });
            if (chainUsed) {
                this.chainStore.recordOutcome(chainUsed.propIds, false);
            }
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
            propPolicySuggestion: this._currentStepPolicy?.primarySuggestion || null,
            policyVersion: this._getChainPolicyVersion(),
            bktMode: this._getChainBktMode(),
            strictNoClues: this._strictNoClues || this._evaluationMode,
            chainUsed: chainUsed
                ? {
                      key: chainUsed.key,
                      score: chainUsed.score,
                      length: chainUsed.length,
                      nodes: chainUsed.nodes?.map((n) => ({
                          text: n.text?.slice(0, 120),
                          probMastery: n.probMastery,
                      })),
                  }
                : null,
            chainCandidates,
            chainsTried,
        });

        this._currentStepPolicy = null;
        this._currentChainContext = null;
        await sleep(this.stepDelayMs);
        return isCorrect;
    }

    async evaluateProblem(problem, options = {}) {
        const persistLearning = options.persistLearning !== false;
        this._evaluationMode = !persistLearning;
        const chainSnapshot = this.chainStore.toJSON();
        try {
            const result = await super.evaluateProblem(problem, options);
            return { ...result, bktMode: "proposition-chain" };
        } finally {
            if (!persistLearning) {
                this.chainStore = ChainReasoningStore.fromJSON(chainSnapshot);
            }
            this._evaluationMode = false;
        }
    }

    buildOutput(run) {
        const output = super.buildOutput(run);
        return {
            ...output,
            bktMode: "proposition-chain",
            agentExtras: this.getAgentExtras?.() || output.agentExtras,
        };
    }

    getAgentExtras() {
        const base = super.getAgentExtras();
        const chainStats = this.chainStore.getStats();
        return {
            ...base,
            strategy: "local-reasoning-llm-propositional-chain-bkt",
            bktMode: "proposition-chain",
            policyVersion: CHAIN_POLICY_VERSION,
            propPolicyVersion: POLICY_VERSION,
            chainStats,
            chainsEvaluated: this.chainsEvaluated,
            chainSuccesses: this.chainSuccesses,
        };
    }
}
