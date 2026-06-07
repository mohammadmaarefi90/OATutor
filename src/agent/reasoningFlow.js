import { normalizePropositionText, propositionId } from "./propositionExtractor.js";

/** Stable ID from proposition text alone — merges duplicates across steps/hints. */
export function semanticPropositionId(text) {
    const normalized = normalizePropositionText(text);
    if (!normalized) return "prop-empty";
    return propositionId(normalized, "semantic");
}

export const FLOW_NODE_TYPES = new Set([
    "problem",
    "step",
    "proposition",
    "hint-proposition",
    "outcome",
]);

export const TRANSITION_META = {
    asks: {
        short: "asks",
        label: "Poses question",
        description: "The problem moves to a new step question",
    },
    supports: {
        short: "supports",
        label: "Supports",
        description: "This proposition follows logically from the previous statement",
    },
    "via-hint": {
        short: "via hint",
        label: "Agent consulted hints",
        description: "After an agent action, the first hint proposition is revealed",
    },
    hint: {
        short: "hint chain",
        label: "Hint progression",
        description: "Next proposition in the hint scaffolding pathway",
    },
    "next-step": {
        short: "next step",
        label: "Next step",
        description: "Transition to the following step in the problem",
    },
    outcome: {
        short: "answer",
        label: "Answer submitted",
        description: "Agent or learner submitted an attempt for this step",
    },
    flow: {
        short: "flow",
        label: "Argument flow",
        description: "Sequential progression in the reasoning chain",
    },
    reasoning: {
        short: "reasoning",
        label: "Reasoning transition",
        description: "Observed transition between propositions across sessions",
    },
};

export function isFlowNodeType(type) {
    return FLOW_NODE_TYPES.has(type);
}

export function formatTransitionLabel(edge) {
    const meta = TRANSITION_META[edge?.type] || TRANSITION_META.reasoning;
    const parts = [meta.label];
    if (edge?.label) parts.push(edge.label);
    if (edge?.count > 1) parts.push(`×${edge.count}`);
    if (edge?.probability != null && edge._showProb !== false) {
        const pct = Math.round(edge.probability * 100);
        parts.push(`P=${pct}%`);
    }
    return parts.join(" · ");
}

export function nodeTypeLabel(type) {
    switch (type) {
        case "problem":
            return "Problem";
        case "step":
            return "Step question";
        case "proposition":
            return "Proposition";
        case "hint-proposition":
            return "Hint proposition";
        case "outcome":
            return "Answer outcome";
        default:
            return type || "Node";
    }
}

/** Remove duplicate propositions by semantic text (keep first). */
export function dedupePropositions(propositions) {
    const seen = new Set();
    const out = [];
    for (const p of propositions || []) {
        const text = normalizePropositionText(p.text);
        if (!text || text.length < 4) continue;
        const id = semanticPropositionId(text);
        if (seen.has(id)) continue;
        seen.add(id);
        out.push({ ...p, text });
    }
    return out;
}

/** One proposition per hint — avoids splitting every sentence into redundant nodes. */
export function consolidateHintProposition(hint) {
    const title = normalizePropositionText(hint.title || "");
    const body = normalizePropositionText(hint.text || "");
    if (title && body && !body.toLowerCase().startsWith(title.toLowerCase().slice(0, 20))) {
        return { text: `${title}. ${body}`.slice(0, 280), title };
    }
    return { text: (body || title || hint.id || "Hint").slice(0, 280), title: title || "" };
}

export function primaryStepLabel(step) {
    const title = normalizePropositionText(step.stepTitle || "");
    if (title) return title.slice(0, 200);
    const body = normalizePropositionText(step.stepBody || "");
    if (!body) return step.id;
    const first = body.split(/(?<=[.!?])\s+/)[0] || body;
    return first.slice(0, 200);
}

function dedupeConsecutive(ids) {
    const out = [];
    for (const id of ids) {
        if (out[out.length - 1] !== id) out.push(id);
    }
    return out;
}

function mergeEdge(existing, incoming) {
    if (!existing) {
        return {
            from: incoming.from,
            to: incoming.to,
            count: incoming.count || 1,
            type: incoming.type || "supports",
            label: incoming.label || "",
            action: incoming.action || "",
        };
    }
    existing.count += incoming.count || 1;
    if (incoming.type && incoming.type !== "flow" && existing.type === "flow") {
        existing.type = incoming.type;
    }
    if (incoming.label && !existing.label) existing.label = incoming.label;
    if (incoming.action && !existing.action) existing.action = incoming.action;
    return existing;
}

/**
 * Build argument-flow DAG for display.
 * @param {'session'|'cumulative'} mode — session = linear path; cumulative = all branches
 */
export function simplifyArgumentFlowDAG(dag, options = {}) {
    if (!dag?.nodes?.length) return dag;

    const mode = options.mode || (dag.simplified ? "session" : "session");
    const nodeMap = Object.fromEntries(dag.nodes.map((n) => [n.id, n]));
    const rawPath = dag.argumentPath || dag.sessionPath || dag.path || [];

    let flowPath = dedupeConsecutive(
        rawPath.filter((id) => {
            const n = nodeMap[id];
            return n && isFlowNodeType(n.type);
        })
    );

    if (flowPath.length === 0) {
        flowPath = dedupeConsecutive(
            dag.nodes.filter((n) => isFlowNodeType(n.type)).map((n) => n.id)
        );
    }

    const flowIdSet = new Set(flowPath);
    const edgeMap = new Map();

    const registerEdge = (from, to, meta = {}) => {
        if (!from || !to || from === to) return;
        const fromNode = nodeMap[from];
        const toNode = nodeMap[to];
        if (!isFlowNodeType(fromNode?.type) || !isFlowNodeType(toNode?.type)) return;

        flowIdSet.add(from);
        flowIdSet.add(to);

        const key = `${from}→${to}`;
        edgeMap.set(key, mergeEdge(edgeMap.get(key), { from, to, ...meta }));
    };

    if (mode === "session") {
        for (let i = 0; i < flowPath.length - 1; i++) {
            const from = flowPath[i];
            const to = flowPath[i + 1];
            const hasExplicit = (dag.edges || []).some((e) => e.from === from && e.to === to);
            if (!hasExplicit) {
                registerEdge(from, to, { type: "flow" });
            }
        }
    }

    (dag.edges || []).forEach((e) => {
        registerEdge(e.from, e.to, e);
    });

    if (mode === "cumulative") {
        flowPath = orderNodesForCumulative([...flowIdSet], [...edgeMap.values()], flowPath);
    }

    const edges = [...edgeMap.values()];
    const outgoing = {};
    edges.forEach((e) => {
        if (!outgoing[e.from]) outgoing[e.from] = [];
        outgoing[e.from].push(e);
    });

    const edgesWithProb = edges.map((e) => {
        const siblings = outgoing[e.from] || [];
        const total = siblings.reduce((s, t) => s + (t.count || 1), 0);
        const showProb = siblings.length > 1 || (e.count || 1) > 1;
        return {
            ...e,
            probability: total > 0 ? (e.count || 1) / total : 1,
            _showProb: showProb,
            transitionLabel: "",
        };
    });

    edgesWithProb.forEach((e) => {
        e.transitionLabel = formatTransitionLabel(e);
    });

    const flowNodes = flowPath.map((id, index) => {
        const n = nodeMap[id] || {};
        return {
            ...n,
            id,
            label: (n.text || n.label || id).slice(0, 200),
            flowIndex: index + 1,
            typeLabel: nodeTypeLabel(n.type),
            onPrimaryPath: rawPath.includes(id),
        };
    });

    [...flowIdSet].forEach((id) => {
        if (flowPath.includes(id)) return;
        const n = nodeMap[id] || {};
        flowNodes.push({
            ...n,
            id,
            label: (n.text || n.label || id).slice(0, 200),
            flowIndex: null,
            typeLabel: nodeTypeLabel(n.type),
            onPrimaryPath: false,
            isBranch: true,
        });
    });

    return {
        ...dag,
        nodes: flowNodes,
        edges: edgesWithProb,
        sessionPath: flowPath,
        path: flowPath,
        argumentPath: flowPath,
        simplified: true,
        displayMode: mode,
        stepTraces: dag.stepTraces || [],
    };
}

/** Primary path first, then branch nodes reachable from path but not on it. */
function orderNodesForCumulative(nodeIds, edges, primaryPath) {
    const ordered = dedupeConsecutive([...primaryPath.filter((id) => nodeIds.includes(id))]);
    const seen = new Set(ordered);
    nodeIds.forEach((id) => {
        if (!seen.has(id)) {
            ordered.push(id);
            seen.add(id);
        }
    });
    return ordered;
}

export function buildSessionDisplayDAG(dag) {
    return simplifyArgumentFlowDAG(dag, { mode: "session" });
}

export function buildCumulativeDisplayDAG(dag) {
    return simplifyArgumentFlowDAG(dag, { mode: "cumulative" });
}
