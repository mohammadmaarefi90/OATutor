import {
    buildStepReasoningNodes,
} from "./ReasoningGraph.js";
import {
    buildSessionDisplayDAG,
    consolidateHintProposition,
    dedupePropositions,
    isFlowNodeType,
    primaryStepLabel,
    semanticPropositionId,
} from "./reasoningFlow.js";

const ACTION_LABELS = {
    "memory-recall": "Memory recall",
    "recall-failed": "Recall failed",
    "learn-from-hints": "Learning from hints",
    "rl-select-action": "RL policy decision",
    "rl-recall": "RL: recall from memory",
    "rl-use-hint": "RL: use hints",
    "rl-submit-best": "RL: submit answer",
    "rl-fallback-hint": "RL: hint fallback",
    "llm-query": "LLM query",
    "llm-response": "LLM response",
    "llm-unavailable": "LLM unavailable",
    "hint-fallback": "Hint fallback",
};

/**
 * Captures a problem-solving trace as a structured argument flow:
 * problem → step question → propositions (chain) → hints (chain) → outcome.
 */
export default class ReasoningSession {
    constructor(problem, agentType) {
        this.problem = problem;
        this.agentType = agentType;
        this.nodes = {};
        this.edges = [];
        this.edgeIndex = {};
        this.path = [];
        this.argumentPath = [];
        this.cursorNodeId = null;
        this.problemNodeId = null;
        this.problemStarted = false;
        this.decisionNodeId = null;
        this.pendingAction = null;
        this.stepCounter = 0;
        this.stepTraces = [];
        this.currentStepTrace = null;
    }

    _addNode(id, text, meta = {}) {
        if (!this.nodes[id]) {
            this.nodes[id] = { id, text: text?.slice(0, 320) || id, ...meta };
        } else if (meta.hintIndex != null && this.nodes[id].hintIndex == null) {
            Object.assign(this.nodes[id], meta);
        }
        return id;
    }

    _trackFlowNode(id) {
        if (!isFlowNodeType(this.nodes[id]?.type)) return;
        if (this.argumentPath[this.argumentPath.length - 1] !== id) {
            this.argumentPath.push(id);
        }
    }

    _link(fromId, toId, type = "supports", label = null, action = null) {
        if (!fromId || !toId || fromId === toId) return toId;

        const key = `${fromId}→${toId}`;
        if (this.edgeIndex[key]) {
            this.edgeIndex[key].count += 1;
            if (label && !this.edgeIndex[key].label) this.edgeIndex[key].label = label;
            if (action && !this.edgeIndex[key].action) this.edgeIndex[key].action = action;
        } else {
            this.edgeIndex[key] = {
                from: fromId,
                to: toId,
                count: 1,
                type,
                label: label || "",
                action: action || "",
            };
            this.edges.push(this.edgeIndex[key]);
        }

        if (!this.path.includes(toId)) this.path.push(toId);
        this.cursorNodeId = toId;
        this._trackFlowNode(toId);
        return toId;
    }

    startProblem() {
        if (this.problemStarted) return this.problemNodeId;

        const title = (this.problem.title || this.problem.id || "Problem").slice(0, 200);
        this.problemNodeId = `problem::${this.problem.id}`;
        this._addNode(this.problemNodeId, title, {
            type: "problem",
            problemId: this.problem.id,
        });
        this.path.push(this.problemNodeId);
        this._trackFlowNode(this.problemNodeId);
        this.cursorNodeId = this.problemNodeId;
        this.problemStarted = true;
        return this.problemNodeId;
    }

    startStep(step) {
        if (!this.problemStarted) this.startProblem();

        this.pendingAction = null;
        this.decisionNodeId = null;
        this.stepCounter += 1;

        const stepLabel = primaryStepLabel(step);
        const stepNodeId = `step::${step.id}`;
        this._addNode(stepNodeId, stepLabel, {
            type: "step",
            stepId: step.id,
            stepIndex: this.stepCounter,
        });

        const prevWasOutcome =
            this.nodes[this.cursorNodeId]?.type === "outcome";
        const linkFrom = this.cursorNodeId || this.problemNodeId;
        this._link(
            linkFrom,
            stepNodeId,
            prevWasOutcome || this.stepCounter > 1 ? "next-step" : "asks"
        );

        let chainCursor = stepNodeId;
        const props = dedupePropositions(buildStepReasoningNodes(step, this.problem.id));
        props.forEach((p, i) => {
            const pid = semanticPropositionId(p.text);
            this._addNode(pid, p.text, {
                type: "proposition",
                stepId: step.id,
                sourceField: p.sourceField,
                propIndex: i + 1,
            });
            this._link(chainCursor, pid, i === 0 ? "asks" : "supports");
            chainCursor = pid;
        });

        this.cursorNodeId = chainCursor;
        this.decisionNodeId = chainCursor;
        this.currentStepTrace = {
            stepId: step.id,
            stepIndex: this.stepCounter,
            stepLabel,
            actions: [],
            path: [...this.argumentPath],
        };
    }

    recordAction(action, detail = "") {
        const friendly = ACTION_LABELS[action] || action;
        this.pendingAction = { action, detail, friendly };
        this.currentStepTrace?.actions.push({ action, detail, friendly });
    }

    visitHint(hint, stepId, hintIndex) {
        const consolidated = consolidateHintProposition(hint);
        const id = semanticPropositionId(consolidated.text);
        this._addNode(id, consolidated.text, {
            type: "hint-proposition",
            hintId: hint.id,
            hintTitle: consolidated.title || hint.title || "",
            stepId,
            hintIndex: hintIndex + 1,
        });

        const from =
            hintIndex === 0 ? this.decisionNodeId || this.cursorNodeId : this.cursorNodeId;
        const actionMeta = hintIndex === 0 ? this.pendingAction : null;
        this._link(
            from,
            id,
            hintIndex === 0 ? "via-hint" : "hint",
            actionMeta ? `${actionMeta.friendly}${actionMeta.detail ? `: ${actionMeta.detail}` : ""}` : null,
            actionMeta?.action || null
        );
        if (hintIndex === 0) this.pendingAction = null;
    }

    recordAnswer(attempt, isCorrect) {
        const stepId = this.currentStepTrace?.stepId || "unknown";
        const outId = `outcome::${stepId}::${Date.now()}`;
        const attemptText = (attempt || "?").slice(0, 80);
        const summary = isCorrect
            ? `Correct: ${attemptText}`
            : `Incorrect: ${attemptText}`;

        this._addNode(outId, summary, {
            type: "outcome",
            stepId,
            isCorrect,
            attempt: attemptText,
        });

        this._link(
            this.cursorNodeId,
            outId,
            "outcome",
            isCorrect ? "correct" : "incorrect",
            this.pendingAction?.action || null
        );
        this.cursorNodeId = outId;
        this.pendingAction = null;

        if (this.currentStepTrace) {
            this.currentStepTrace.result = { attempt, isCorrect, attemptText };
            this.currentStepTrace.path = [...this.argumentPath];
            this.stepTraces.push(this.currentStepTrace);
        }
    }

    toDAG() {
        const outgoing = {};
        this.edges.forEach((e) => {
            if (!outgoing[e.from]) outgoing[e.from] = [];
            outgoing[e.from].push(e);
        });

        const edgesWithProb = this.edges.map((e) => {
            const siblings = outgoing[e.from] || [];
            const total = siblings.reduce((s, t) => s + (t.count || 1), 0);
            return {
                ...e,
                probability: total > 0 ? (e.count || 1) / total : 1,
                _showProb: siblings.length > 1,
            };
        });

        const raw = {
            problemId: this.problem.id,
            problemTitle: this.problem.title,
            agentType: this.agentType,
            nodes: Object.values(this.nodes).map((n) => ({
                ...n,
                label: n.text?.slice(0, 200) || n.id,
            })),
            edges: edgesWithProb,
            path: this.path,
            sessionPath: [...this.argumentPath],
            argumentPath: [...this.argumentPath],
            stepTraces: this.stepTraces,
        };

        return buildSessionDisplayDAG(raw);
    }
}

export function mergeSessionIntoGraph(graph, session) {
    const dag = session.toDAG();
    graph.mergeSession(dag);
    return graph.exportDAG(dag.sessionPath);
}
