export const AGENT_TYPES = {
    MEMORY: "memory",
    RL: "rl",
    LLM: "llm",
    LOCAL_LLM: "local-llm",
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
};

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
