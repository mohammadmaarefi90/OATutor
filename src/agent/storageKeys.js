export const AGENT_MEMORY_STORAGE_KEY = (lessonId, agentType = "memory") =>
    `oatutor-agent-memory-${agentType}-${lessonId}`;
export const AGENT_GRAPH_STORAGE_KEY = (lessonId, agentType = "memory") =>
    `oatutor-agent-graph-${agentType}-${lessonId}`;
export const AGENT_PERFORMANCE_STORAGE_KEY = (lessonId, agentType = "memory") =>
    `oatutor-agent-performance-${agentType}-${lessonId}`;
export const AGENT_RL_QTABLE_STORAGE_KEY = (lessonId) => `oatutor-agent-rl-qtable-${lessonId}`;
export const AGENT_REASONING_STORAGE_KEY = (lessonId, agentType) =>
    `oatutor-agent-reasoning-${agentType}-${lessonId}`;
export const AGENT_COMPARISON_STORAGE_KEY = (lessonId) => `oatutor-agent-comparison-${lessonId}`;
export const AGENT_EVALUATION_STORAGE_KEY = (lessonId) => `oatutor-agent-evaluation-${lessonId}`;
export const AGENT_CURRICULUM_REPORT_STORAGE_KEY = (courseName) =>
    `oatutor-agent-curriculum-${courseName.replace(/[^a-z0-9]/gi, "_").toLowerCase()}`;
export const AGENT_CURRICULUM_CHECKPOINT_KEY = (courseName) =>
    `oatutor-agent-curriculum-checkpoint-${courseName.replace(/[^a-z0-9]/gi, "_").toLowerCase()}`;
export const SESSION_MODE_STORAGE_KEY = (lessonId) => `oatutor-session-mode-${lessonId}`;

export const SESSION_MODES = {
    STUDENT: "student",
    AGENT: "agent",
};
