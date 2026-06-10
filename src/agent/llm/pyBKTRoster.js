import { cloneBktParams } from "../bktSnapshot.js";
import {
    buildSkillParamsForLesson,
    fetchPyBktMastery,
    initPyBktSession,
    lessonMasteryFromMap,
    probePyBktServer,
    updateLocalPyBktState,
    updatePyBktSkill,
} from "./pyBKTClient.js";

/**
 * Skill BKT state for Local GPT-OSS when backend is pyBKT.
 * Tries local pyBKT service; falls back to isolated classic updates.
 */
export default class PyBKTRoster {
    constructor(lessonId, lesson, bktParams, initialData = null) {
        this.lessonId = lessonId;
        this.lesson = lesson;
        this.templateParams = cloneBktParams(bktParams);
        this.masteryBySkill = initialData?.masteryBySkill || {};
        this.stateBySkill = initialData?.stateBySkill || {};
        this.useService = initialData?.useService ?? false;
        this.lastError = initialData?.lastError || null;
        this.fittedSkills = initialData?.fittedSkills || null;
        this.updatedAt = initialData?.updatedAt || Date.now();
    }

    static fromJSON(data, lesson, bktParams) {
        if (!data) return null;
        return new PyBKTRoster(data.lessonId, lesson, bktParams, data);
    }

    toJSON() {
        return {
            lessonId: this.lessonId,
            masteryBySkill: { ...this.masteryBySkill },
            stateBySkill: cloneBktParams(this.stateBySkill),
            useService: this.useService,
            lastError: this.lastError,
            fittedSkills: this.fittedSkills,
            updatedAt: Date.now(),
        };
    }

    async ensureSession(settings) {
        const probe = await probePyBktServer(settings);
        if (!probe.ok) {
            this.useService = false;
            this.lastError = probe.message;
            return false;
        }
        const skills = buildSkillParamsForLesson(this.lesson, this.templateParams);
        try {
            await initPyBktSession(this.lessonId, skills, settings);
            this.useService = true;
            this.lastError = null;
            const remote = await fetchPyBktMastery(this.lessonId, settings);
            if (remote) this.masteryBySkill = { ...this.masteryBySkill, ...remote };
            return true;
        } catch (err) {
            this.useService = false;
            this.lastError = err.message;
            return false;
        }
    }

    async update(skills, isCorrect, settings) {
        const skillList = skills?.length ? skills : Object.keys(this.lesson.learningObjectives || {});
        for (const skill of skillList) {
            if (!this.templateParams[skill] && !this.stateBySkill[skill]) continue;

            if (this.useService) {
                try {
                    const prob = await updatePyBktSkill(
                        this.lessonId,
                        skill,
                        isCorrect,
                        settings
                    );
                    this.masteryBySkill[skill] = prob;
                } catch (err) {
                    this.useService = false;
                    this.lastError = err.message;
                    const prob = updateLocalPyBktState(
                        this.stateBySkill,
                        skill,
                        isCorrect,
                        this.templateParams
                    );
                    this.masteryBySkill[skill] = prob;
                }
            } else {
                const prob = updateLocalPyBktState(
                    this.stateBySkill,
                    skill,
                    isCorrect,
                    this.templateParams
                );
                this.masteryBySkill[skill] = prob;
            }
        }
        this.updatedAt = Date.now();
        return this.getLessonMastery();
    }

    getLessonMastery() {
        return lessonMasteryFromMap(this.lesson, this.masteryBySkill);
    }

    getStats() {
        return {
            skillCount: Object.keys(this.masteryBySkill).length,
            useService: this.useService,
            lastError: this.lastError,
        };
    }
}
