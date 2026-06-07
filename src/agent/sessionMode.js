/**
 * Resolve session mode from URL query param or localStorage.
 */
import { SESSION_MODES, SESSION_MODE_STORAGE_KEY } from "../agent/storageKeys.js";

export function getSessionModeFromLocation(location, lessonId) {
    const search =
        location?.search ||
        (location?.hash?.includes("?")
            ? location.hash.substr(location.hash.indexOf("?"))
            : "");
    const params = new URLSearchParams(search.replace(/^\?/, ""));
    const fromUrl = params.get("session_mode");

    if (fromUrl === SESSION_MODES.AGENT || fromUrl === SESSION_MODES.STUDENT) {
        if (lessonId) {
            localStorage.setItem(SESSION_MODE_STORAGE_KEY(lessonId), fromUrl);
        }
        return fromUrl;
    }

    if (lessonId) {
        const stored = localStorage.getItem(SESSION_MODE_STORAGE_KEY(lessonId));
        if (stored === SESSION_MODES.AGENT || stored === SESSION_MODES.STUDENT) {
            return stored;
        }
    }

    return SESSION_MODES.STUDENT;
}

export function buildLessonUrl(lessonId, mode) {
    return `/lessons/${lessonId}?session_mode=${mode}`;
}
