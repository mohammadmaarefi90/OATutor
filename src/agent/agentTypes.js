export const AGENT_TYPES = {
    MEMORY: "memory",
    RL: "rl",
    LLM: "llm",
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
};

export const ALL_AGENT_TYPES = Object.values(AGENT_TYPES);
