/**
 * Portable export/import for per-lesson agent training state (IndexedDB / localforage).
 */

import { AGENT_TYPES } from "./agentTypes.js";
import {
    AGENT_MEMORY_STORAGE_KEY,
    AGENT_GRAPH_STORAGE_KEY,
    AGENT_PERFORMANCE_STORAGE_KEY,
    AGENT_RL_QTABLE_STORAGE_KEY,
    AGENT_REASONING_STORAGE_KEY,
    AGENT_BELIEFS_STORAGE_KEY,
    AGENT_PROP_BKT_STORAGE_KEY,
    AGENT_CHAIN_REASONING_STORAGE_KEY,
    AGENT_PYBKT_ROSTER_STORAGE_KEY,
    AGENT_COMPARISON_STORAGE_KEY,
    AGENT_EVALUATION_STORAGE_KEY,
    AGENT_CURRICULUM_REPORT_STORAGE_KEY,
    AGENT_CURRICULUM_CHECKPOINT_KEY,
} from "./storageKeys.js";
import { safeJsonStringify } from "./curriculumReportExport.js";

export const AGENT_BACKUP_FORMAT = "oatutor-agent-backup";
export const AGENT_BACKUP_VERSION = 1;

export const AGENT_SLOT_LABELS = {
    memory: "Episodic memory",
    graph: "Proposition graph",
    performance: "Training run history",
    reasoning: "Reasoning graph",
    qtable: "RL Q-table",
    beliefs: "Hint beliefs (GPT-OSS)",
    pybkt_roster: "pyBKT skill roster",
    prop_bkt: "Propositional BKT engine",
    chain_reasoning: "Proposition chain stats",
    comparison: "Agent comparison report",
    evaluation: "Evaluation report",
    curriculum_report: "Curriculum report",
    curriculum_checkpoint: "Curriculum checkpoint",
};

/** @type {Record<string, { slot: string, keyFn: (lessonId: string, agentType: string) => string }[]>} */
const AGENT_STATE_SLOTS = {
    [AGENT_TYPES.MEMORY]: [
        { slot: "memory", keyFn: (lessonId, agentType) => AGENT_MEMORY_STORAGE_KEY(lessonId, agentType) },
        { slot: "graph", keyFn: (lessonId, agentType) => AGENT_GRAPH_STORAGE_KEY(lessonId, agentType) },
        { slot: "performance", keyFn: (lessonId, agentType) => AGENT_PERFORMANCE_STORAGE_KEY(lessonId, agentType) },
        { slot: "reasoning", keyFn: (lessonId, agentType) => AGENT_REASONING_STORAGE_KEY(lessonId, agentType) },
    ],
    [AGENT_TYPES.RL]: [
        { slot: "qtable", keyFn: (lessonId) => AGENT_RL_QTABLE_STORAGE_KEY(lessonId) },
        { slot: "performance", keyFn: (lessonId, agentType) => AGENT_PERFORMANCE_STORAGE_KEY(lessonId, agentType) },
        { slot: "reasoning", keyFn: (lessonId, agentType) => AGENT_REASONING_STORAGE_KEY(lessonId, agentType) },
    ],
    [AGENT_TYPES.LLM]: [
        { slot: "performance", keyFn: (lessonId, agentType) => AGENT_PERFORMANCE_STORAGE_KEY(lessonId, agentType) },
        { slot: "reasoning", keyFn: (lessonId, agentType) => AGENT_REASONING_STORAGE_KEY(lessonId, agentType) },
    ],
    [AGENT_TYPES.LOCAL_LLM]: [
        { slot: "performance", keyFn: (lessonId, agentType) => AGENT_PERFORMANCE_STORAGE_KEY(lessonId, agentType) },
        { slot: "reasoning", keyFn: (lessonId, agentType) => AGENT_REASONING_STORAGE_KEY(lessonId, agentType) },
        { slot: "beliefs", keyFn: (lessonId, agentType) => AGENT_BELIEFS_STORAGE_KEY(lessonId, agentType) },
        { slot: "pybkt_roster", keyFn: (lessonId, agentType) => AGENT_PYBKT_ROSTER_STORAGE_KEY(lessonId, agentType) },
    ],
    [AGENT_TYPES.LOCAL_LLM_PROP]: [
        { slot: "performance", keyFn: (lessonId, agentType) => AGENT_PERFORMANCE_STORAGE_KEY(lessonId, agentType) },
        { slot: "reasoning", keyFn: (lessonId, agentType) => AGENT_REASONING_STORAGE_KEY(lessonId, agentType) },
        { slot: "prop_bkt", keyFn: (lessonId, agentType) => AGENT_PROP_BKT_STORAGE_KEY(lessonId, agentType) },
    ],
    [AGENT_TYPES.LOCAL_LLM_PROP_CHAIN]: [
        { slot: "performance", keyFn: (lessonId, agentType) => AGENT_PERFORMANCE_STORAGE_KEY(lessonId, agentType) },
        { slot: "reasoning", keyFn: (lessonId, agentType) => AGENT_REASONING_STORAGE_KEY(lessonId, agentType) },
        { slot: "prop_bkt", keyFn: (lessonId, agentType) => AGENT_PROP_BKT_STORAGE_KEY(lessonId, agentType) },
        { slot: "chain_reasoning", keyFn: (lessonId, agentType) => AGENT_CHAIN_REASONING_STORAGE_KEY(lessonId, agentType) },
    ],
    [AGENT_TYPES.LOCAL_LLM_PROP_CHAIN_TREE]: [
        { slot: "performance", keyFn: (lessonId, agentType) => AGENT_PERFORMANCE_STORAGE_KEY(lessonId, agentType) },
        { slot: "reasoning", keyFn: (lessonId, agentType) => AGENT_REASONING_STORAGE_KEY(lessonId, agentType) },
        { slot: "prop_bkt", keyFn: (lessonId, agentType) => AGENT_PROP_BKT_STORAGE_KEY(lessonId, agentType) },
        { slot: "chain_reasoning", keyFn: (lessonId, agentType) => AGENT_CHAIN_REASONING_STORAGE_KEY(lessonId, agentType) },
    ],
};

export function getDefaultExportAgentTypes() {
    return [
        AGENT_TYPES.MEMORY,
        AGENT_TYPES.RL,
        AGENT_TYPES.LLM,
        AGENT_TYPES.LOCAL_LLM,
        AGENT_TYPES.LOCAL_LLM_PROP,
        AGENT_TYPES.LOCAL_LLM_PROP_CHAIN,
        AGENT_TYPES.LOCAL_LLM_PROP_CHAIN_TREE,
    ];
}

export function buildLessonStoragePlan(lessonId, agentTypes, { includeReports = false } = {}) {
    const entries = [];
    for (const agentType of agentTypes) {
        const specs = AGENT_STATE_SLOTS[agentType] || [];
        for (const spec of specs) {
            entries.push({
                agentType,
                slot: spec.slot,
                storageKey: spec.keyFn(lessonId, agentType),
            });
        }
    }
    if (includeReports) {
        entries.push({
            agentType: null,
            slot: "comparison",
            storageKey: AGENT_COMPARISON_STORAGE_KEY(lessonId),
        });
        entries.push({
            agentType: null,
            slot: "evaluation",
            storageKey: AGENT_EVALUATION_STORAGE_KEY(lessonId),
        });
    }
    return entries;
}

export function remapStorageKey(storageKey, fromLessonId, toLessonId) {
    if (!fromLessonId || !toLessonId || fromLessonId === toLessonId) return storageKey;
    const suffix = `-${fromLessonId}`;
    if (storageKey.endsWith(suffix)) {
        return `${storageKey.slice(0, -suffix.length)}-${toLessonId}`;
    }
    return storageKey;
}

function summarizeSlotData(slot, data) {
    if (!data || typeof data !== "object") return "saved";
    switch (slot) {
        case "memory":
            return `${Object.keys(data.entries || {}).length} remembered answer(s)`;
        case "graph":
            return `${Object.keys(data.nodes || {}).length} proposition node(s)`;
        case "performance":
            return `${(data.runs || []).length} training run(s)`;
        case "reasoning":
            return `${data.totalTransitions || 0} reasoning transition(s)`;
        case "qtable":
            return `${Object.keys(data.qTable || {}).length} RL state(s)`;
        case "beliefs":
            return `${data.totalBeliefs || 0} hint belief(s)`;
        case "pybkt_roster":
            return `${Object.keys(data.masteryBySkill || {}).length} skill(s) tracked`;
        case "prop_bkt":
            return `${Object.keys(data.beliefs || data.propositionBeliefs || {}).length} proposition belief(s)`;
        case "chain_reasoning":
            return `${Object.keys(data.chainStats || data.stepChainIndex || {}).length} learned chain(s)`;
        case "comparison":
            return data.winner?.agentLabel ? `winner: ${data.winner.agentLabel}` : "comparison saved";
        case "evaluation":
            return `${(data.problemResults || []).length} evaluated problem(s)`;
        case "curriculum_report":
            return data.testEvaluation ? "train/test report" : "curriculum report";
        case "curriculum_checkpoint":
            return data.trainingCompletedAt
                ? `trained ${new Date(data.trainingCompletedAt).toLocaleString()}`
                : "checkpoint";
        default:
            return "saved";
    }
}

export async function scanLessonAgentState(browserStorage, lessonId, agentTypes, options = {}) {
    if (!browserStorage || !lessonId) return [];
    const plan = buildLessonStoragePlan(lessonId, agentTypes, options);
    const found = [];
    for (const item of plan) {
        const data = await browserStorage.getByKey(item.storageKey).catch(() => null);
        if (data != null) {
            found.push({
                ...item,
                summary: summarizeSlotData(item.slot, data),
            });
        }
    }
    return found;
}

async function collectPlanEntries(browserStorage, plan) {
    const entries = [];
    for (const item of plan) {
        const data = await browserStorage.getByKey(item.storageKey).catch(() => null);
        if (data != null) {
            entries.push({ ...item, data });
        }
    }
    return entries;
}

export async function exportLessonAgentBackup(
    browserStorage,
    { lessonId, lessonTitle, agentTypes, includeReports = false } = {}
) {
    if (!browserStorage || !lessonId) {
        throw new Error("Browser storage and lesson ID are required to export.");
    }
    const types = agentTypes || getDefaultExportAgentTypes();
    const plan = buildLessonStoragePlan(lessonId, types, { includeReports });
    const entries = await collectPlanEntries(browserStorage, plan);

    return {
        format: AGENT_BACKUP_FORMAT,
        version: AGENT_BACKUP_VERSION,
        scope: "lesson",
        exportedAt: Date.now(),
        lessonId,
        lessonTitle: lessonTitle || lessonId,
        agentTypes: types,
        includeReports,
        entries,
    };
}

export async function exportCourseAgentBackup(
    browserStorage,
    { courseName, lessons = [], agentTypes, includeReports = false, includeCurriculum = true } = {}
) {
    if (!browserStorage) {
        throw new Error("Browser storage is required to export.");
    }
    const types = agentTypes || getDefaultExportAgentTypes();
    const lessonBackups = [];

    for (const lesson of lessons) {
        const lessonId = lesson.id || lesson.lessonId;
        if (!lessonId) continue;
        const entries = await collectPlanEntries(
            browserStorage,
            buildLessonStoragePlan(lessonId, types, { includeReports })
        );
        if (entries.length > 0) {
            lessonBackups.push({
                lessonId,
                lessonTitle: lesson.name || lesson.title || lessonId,
                entries,
            });
        }
    }

    let curriculum = null;
    if (includeCurriculum && courseName) {
        const [report, checkpoint] = await Promise.all([
            browserStorage.getByKey(AGENT_CURRICULUM_REPORT_STORAGE_KEY(courseName)).catch(() => null),
            browserStorage.getByKey(AGENT_CURRICULUM_CHECKPOINT_KEY(courseName)).catch(() => null),
        ]);
        if (report || checkpoint) {
            curriculum = { report, checkpoint };
        }
    }

    return {
        format: AGENT_BACKUP_FORMAT,
        version: AGENT_BACKUP_VERSION,
        scope: "course",
        exportedAt: Date.now(),
        courseName: courseName || "course",
        agentTypes: types,
        includeReports,
        lessons: lessonBackups,
        curriculum,
    };
}

export function summarizeAgentBackup(backup) {
    if (!backup || backup.format !== AGENT_BACKUP_FORMAT) {
        return { valid: false, message: "Not a recognized OATutor agent backup file." };
    }

    if (backup.scope === "course") {
        const lessonSummaries = (backup.lessons || []).map((lb) => ({
            lessonId: lb.lessonId,
            lessonTitle: lb.lessonTitle,
            agentTypes: [...new Set(lb.entries.map((e) => e.agentType).filter(Boolean))],
            slots: lb.entries.map((e) => ({
                agentType: e.agentType,
                slot: e.slot,
                label: AGENT_SLOT_LABELS[e.slot] || e.slot,
            })),
            entryCount: lb.entries.length,
        }));
        const curriculumSlots = [];
        if (backup.curriculum?.report) curriculumSlots.push("curriculum_report");
        if (backup.curriculum?.checkpoint) curriculumSlots.push("curriculum_checkpoint");
        return {
            valid: true,
            scope: "course",
            courseName: backup.courseName,
            exportedAt: backup.exportedAt,
            lessonCount: lessonSummaries.length,
            lessons: lessonSummaries,
            curriculumSlots,
            totalEntries:
                lessonSummaries.reduce((n, l) => n + l.entryCount, 0) + curriculumSlots.length,
        };
    }

    const agentTypes = [...new Set((backup.entries || []).map((e) => e.agentType).filter(Boolean))];
    return {
        valid: true,
        scope: "lesson",
        lessonId: backup.lessonId,
        lessonTitle: backup.lessonTitle,
        exportedAt: backup.exportedAt,
        agentTypes,
        slots: (backup.entries || []).map((e) => ({
            agentType: e.agentType,
            slot: e.slot,
            label: AGENT_SLOT_LABELS[e.slot] || e.slot,
            summary: summarizeSlotData(e.slot, e.data),
        })),
        entryCount: (backup.entries || []).length,
    };
}

function shouldImportEntry(entry, agentTypes) {
    if (!agentTypes || agentTypes.length === 0) return true;
    if (!entry.agentType) return true;
    return agentTypes.includes(entry.agentType);
}

async function importLessonEntries(browserStorage, entries, { agentTypes, targetLessonId, sourceLessonId }) {
    let restored = 0;
    for (const entry of entries) {
        if (!shouldImportEntry(entry, agentTypes)) continue;
        const storageKey = remapStorageKey(entry.storageKey, sourceLessonId, targetLessonId);
        await browserStorage.setByKey(storageKey, entry.data);
        restored += 1;
    }
    return restored;
}

export async function importAgentBackup(
    browserStorage,
    backup,
    { agentTypes = null, targetLessonId = null, targetCourseName = null } = {}
) {
    if (!browserStorage) {
        throw new Error("Browser storage is required to import.");
    }
    if (!backup || backup.format !== AGENT_BACKUP_FORMAT) {
        throw new Error("Invalid backup file — expected an OATutor agent backup.");
    }
    if (backup.version !== AGENT_BACKUP_VERSION) {
        throw new Error(`Unsupported backup version ${backup.version}.`);
    }

    let restored = 0;

    if (backup.scope === "course") {
        const courseName = targetCourseName || backup.courseName;
        for (const lessonBackup of backup.lessons || []) {
            const lessonId = targetLessonId || lessonBackup.lessonId;
            restored += await importLessonEntries(browserStorage, lessonBackup.entries || [], {
                agentTypes,
                targetLessonId: lessonId,
                sourceLessonId: lessonBackup.lessonId,
            });
        }
        if (backup.curriculum && courseName) {
            if (backup.curriculum.report) {
                await browserStorage.setByKey(
                    AGENT_CURRICULUM_REPORT_STORAGE_KEY(courseName),
                    backup.curriculum.report
                );
                restored += 1;
            }
            if (backup.curriculum.checkpoint) {
                await browserStorage.setByKey(
                    AGENT_CURRICULUM_CHECKPOINT_KEY(courseName),
                    backup.curriculum.checkpoint
                );
                restored += 1;
            }
        }
        return { restored, scope: "course", courseName };
    }

    const lessonId = targetLessonId || backup.lessonId;
    restored = await importLessonEntries(browserStorage, backup.entries || [], {
        agentTypes,
        targetLessonId: lessonId,
        sourceLessonId: backup.lessonId,
    });
    return { restored, scope: "lesson", lessonId };
}

export function parseAgentBackupJson(text) {
    const parsed = JSON.parse(text);
    if (!parsed || parsed.format !== AGENT_BACKUP_FORMAT) {
        throw new Error("This file is not an OATutor agent backup.");
    }
    return parsed;
}

export async function parseAgentBackupFile(file) {
    const text = await file.text();
    return parseAgentBackupJson(text);
}

export function downloadAgentBackupFile(backup, filename) {
    const json = safeJsonStringify(backup);
    const blob = new Blob([json], { type: "application/json;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = filename;
    anchor.style.display = "none";
    document.body.appendChild(anchor);
    anchor.click();
    document.body.removeChild(anchor);
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    return json;
}

export function defaultBackupFilename({ scope, lessonId, courseName }) {
    const stamp = new Date().toISOString().slice(0, 10);
    if (scope === "course") {
        const safe = String(courseName || "course").replace(/[^a-z0-9]+/gi, "-").toLowerCase();
        return `oatutor-agents-course-${safe}-${stamp}.json`;
    }
    const safeLesson = String(lessonId || "lesson").replace(/[^a-z0-9]+/gi, "-").toLowerCase();
    return `oatutor-agents-${safeLesson}-${stamp}.json`;
}
