/**
 * HTTP client for local pyBKT roster service (scripts/serve-pybkt.py).
 * Used only when skill BKT backend is "pybkt" on Local GPT-OSS agent.
 */

import updateBKT from "../../models/BKT/BKT-brain.js";
import { getLLMSettingsSync } from "./llmSettings.js";

const DEFAULT_BASE = "http://127.0.0.1:8090";

export function getPyBktBaseUrl(settings) {
    const s = settings || getLLMSettingsSync();
    return (s.pyBktBaseUrl || DEFAULT_BASE).replace(/\/$/, "");
}

export async function probePyBktServer(settings) {
    const base = getPyBktBaseUrl(settings);
    try {
        const res = await fetch(`${base}/health`, { method: "GET" });
        if (!res.ok) return { ok: false, message: `HTTP ${res.status}` };
        const data = await res.json();
        return { ok: !!data.ok, message: "pyBKT service ready", baseUrl: base };
    } catch (err) {
        return {
            ok: false,
            message: err.message || "Unreachable",
            hint: "Run: ./scripts/serve-pybkt.sh",
        };
    }
}

export async function initPyBktSession(lessonId, skillParams, settings) {
    const base = getPyBktBaseUrl(settings);
    const res = await fetch(`${base}/v1/session/init`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ lessonId, skills: skillParams }),
    });
    if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || `pyBKT init failed (${res.status})`);
    }
    return res.json();
}

export async function updatePyBktSkill(lessonId, skill, isCorrect, settings) {
    const base = getPyBktBaseUrl(settings);
    const res = await fetch(`${base}/v1/session/update`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ lessonId, skill, correct: isCorrect }),
    });
    if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || `pyBKT update failed (${res.status})`);
    }
    const data = await res.json();
    return data.probMastery;
}

export async function fetchPyBktMastery(lessonId, settings) {
    const base = getPyBktBaseUrl(settings);
    const res = await fetch(
        `${base}/v1/session/mastery?lessonId=${encodeURIComponent(lessonId)}`
    );
    if (!res.ok) return null;
    const data = await res.json();
    return data.masteryBySkill || {};
}

/**
 * Local fallback when pyBKT server is offline: same 4-param update as OATutor classic.
 */
export function updateLocalPyBktState(stateBySkill, skill, isCorrect, templateParams) {
    if (!stateBySkill[skill]) {
        const tpl = templateParams[skill] || {
            probMastery: 0.1,
            probTransit: 0.1,
            probGuess: 0.1,
            probSlip: 0.1,
        };
        stateBySkill[skill] = JSON.parse(JSON.stringify(tpl));
    }
    updateBKT(stateBySkill[skill], isCorrect);
    return stateBySkill[skill].probMastery;
}

export function buildSkillParamsForLesson(lesson, bktParams) {
    const skills = Object.keys(lesson.learningObjectives || {});
    const out = {};
    for (const skill of skills) {
        if (bktParams[skill]) {
            out[skill] = { ...bktParams[skill] };
        }
    }
    return out;
}

export function lessonMasteryFromMap(lesson, masteryBySkill) {
    const skills = Object.keys(lesson.learningObjectives || {});
    if (skills.length === 0) return 0;
    const sum = skills.reduce((s, k) => s + (masteryBySkill[k] ?? 0), 0);
    return sum / skills.length;
}
