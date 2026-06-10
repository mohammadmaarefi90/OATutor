export const AGENT_TYPES = {
    MEMORY: "memory",
    RL: "rl",
    LLM: "llm",
    LOCAL_LLM: "local-llm",
    LOCAL_LLM_PROP: "local-llm-prop-bkt",
    LOCAL_LLM_PROP_CHAIN: "local-llm-prop-chain-bkt",
    LOCAL_LLM_PROP_CHAIN_TREE: "local-llm-prop-chain-tree-bkt",
};

export const AGENT_META = {
    [AGENT_TYPES.MEMORY]: {
        id: AGENT_TYPES.MEMORY,
        label: "Memory Agent",
        shortLabel: "Memory",
        description:
            "Rule-based learner with episodic memory and a proposition graph built from hint pathways.",
        color: "#1976d2",
    },
    [AGENT_TYPES.RL]: {
        id: AGENT_TYPES.RL,
        label: "RL Agent",
        shortLabel: "RL",
        description:
            "Tabular Q-learning agent that learns when to recall, use hints, or explore via reward signals.",
        color: "#388e3c",
    },
    [AGENT_TYPES.LLM]: {
        id: AGENT_TYPES.LLM,
        label: "LLM Agent",
        shortLabel: "LLM",
        description:
            "Language-model agent that requests answers from the AI hint endpoint (falls back to hints if unavailable).",
        color: "#7b1fa2",
    },
    [AGENT_TYPES.LOCAL_LLM]: {
        id: AGENT_TYPES.LOCAL_LLM,
        label: "Local GPT-OSS Agent",
        shortLabel: "GPT-OSS",
        description:
            "Reasoning model via local llama.cpp (OpenAI-compatible API). Learns hint beliefs during training; uses them on held-out test problems.",
        color: "#e65100",
    },
    [AGENT_TYPES.LOCAL_LLM_PROP]: {
        id: AGENT_TYPES.LOCAL_LLM_PROP,
        label: "Local GPT-OSS + Propositional BKT",
        shortLabel: "Prop-BKT",
        tableLabel: "GPT-OSS (Prop BKT)",
        description:
            "Local gpt-oss reasoning with proposition-based belief updates — P(know proposition) on each idea and reasoning chain, not only whole skills.",
        color: "#6a1b9a",
        bktMode: "proposition",
    },
    [AGENT_TYPES.LOCAL_LLM_PROP_CHAIN]: {
        id: AGENT_TYPES.LOCAL_LLM_PROP_CHAIN,
        label: "Local GPT-OSS + Prop BKT Chain Reasoning",
        shortLabel: "Prop-Chain",
        tableLabel: "GPT-OSS (Prop Chain)",
        description:
            "Propositional BKT agent that loops through ordered idea chains from lesson structure. Training learns chain transitions from hints; test runs strict no-clue chain evaluation toward the conclusion.",
        color: "#4527a0",
        bktMode: "proposition-chain",
    },
    [AGENT_TYPES.LOCAL_LLM_PROP_CHAIN_TREE]: {
        id: AGENT_TYPES.LOCAL_LLM_PROP_CHAIN_TREE,
        label: "Local GPT-OSS + Prop BKT Chain Tree",
        shortLabel: "Prop-Tree",
        tableLabel: "GPT-OSS (Prop Tree)",
        description:
            "Beam-search tree over proposition chains: at each leaf, extend with the most relevant next idea (structure + Prop BKT ranking). Tries best complete branches with local gpt-oss.",
        color: "#283593",
        bktMode: "proposition-chain-tree",
    },
};

/** Local LLM agents (skill BKT vs propositional BKT) — not in 3-agent comparison. */
export const LOCAL_LLM_AGENT_TYPES = [
    AGENT_TYPES.LOCAL_LLM,
    AGENT_TYPES.LOCAL_LLM_PROP,
    AGENT_TYPES.LOCAL_LLM_PROP_CHAIN,
    AGENT_TYPES.LOCAL_LLM_PROP_CHAIN_TREE,
];

/** Original three agents — unchanged for comparison pipelines. */
export const ALL_AGENT_TYPES = [
    AGENT_TYPES.MEMORY,
    AGENT_TYPES.RL,
    AGENT_TYPES.LLM,
];

/** Includes local reasoning LLM for dedicated curriculum / single-agent runs. */
export const ALL_CURRICULUM_AGENT_TYPES = [
    ...ALL_AGENT_TYPES,
    AGENT_TYPES.LOCAL_LLM,
];

/** Lesson evaluation box: legacy agents + trained local GPT-OSS variants. */
export const EVALUATION_AGENT_TYPES = [
    ...ALL_AGENT_TYPES,
    ...LOCAL_LLM_AGENT_TYPES,
];
