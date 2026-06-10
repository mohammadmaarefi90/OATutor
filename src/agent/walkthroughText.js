/**
 * Plain-English helpers for agent evaluation walkthroughs.
 * Renders math content as readable sentences alongside LaTeX.
 */

function stripMarkup(text) {
    if (!text || typeof text !== "string") return "";
    return text
        .replace(/\\n/g, " ")
        .replace(/##[^#]+##/g, "")
        .replace(/%\{[^}]+\}/g, "")
        .replace(/\s+/g, " ")
        .trim();
}

/**
 * Lightweight LaTeX → readable English (not a full parser).
 */
export function latexToPlainEnglish(text) {
    let s = stripMarkup(text);
    if (!s) return "";

    s = s.replace(/\$\$([^$]+)\$\$/g, " $1 ");
    s = s.replace(/\$([^$]+)\$/g, " $1 ");

    const replacements = [
        [/\\text\{([^}]*)\}/g, "$1"],
        [/\\textbf\{([^}]*)\}/g, "$1"],
        [/\\textit\{([^}]*)\}/g, "$1"],
        [/\\cdot/g, " times "],
        [/\\times/g, " times "],
        [/\\div/g, " divided by "],
        [/\\pm/g, " plus or minus "],
        [/\\leq/g, " is less than or equal to "],
        [/\\geq/g, " is greater than or equal to "],
        [/\\neq/g, " is not equal to "],
        [/\\approx/g, " is approximately "],
        [/\\sqrt\{([^}]*)\}/g, "the square root of $1"],
        [/\\frac\{([^}]*)\}\{([^}]*)\}/g, "($1) divided by ($2)"],
        [/\\left\(/g, "("],
        [/\\right\)/g, ")"],
        [/\\left\[/g, "["],
        [/\\right\]/g, "]"],
        [/\\,/g, " "],
        [/\\;/g, " "],
        [/\\!/g, ""],
        [/\\%/g, "%"],
        [/\\\{/g, "{"],
        [/\\\}/g, "}"],
        [/\\_/g, "_"],
    ];

    for (const [pattern, repl] of replacements) {
        s = s.replace(pattern, repl);
    }

    // Exponents: 4^{2x} → 4 to the power (2x)
    s = s.replace(/([0-9a-zA-Z])\^\{([^}]+)\}/g, "$1 to the power ($2)");
    s = s.replace(/([0-9a-zA-Z])\^([0-9a-zA-Z])/g, "$1 to the power $2");

    s = s.replace(/_{([^}]+)}/g, " subscript $1 ");
    s = s.replace(/\\[a-zA-Z]+/g, " ");
    s = s.replace(/[{}]/g, "");
    s = s.replace(/\s+/g, " ").trim();

    if (/^simplify:/i.test(s)) {
        s = s.replace(/^simplify:\s*/i, "Simplify: ");
    }
    if (/^solve:/i.test(s)) {
        s = s.replace(/^solve:\s*/i, "Solve: ");
    }
    if (/^find:/i.test(s)) {
        s = s.replace(/^find:\s*/i, "Find: ");
    }

    return s;
}

export function describeAnswerType(answerType) {
    switch (answerType) {
        case "arithmetic":
            return "Enter a simplified expression or number.";
        case "string":
            return "Enter a short text answer.";
        case "algebraic":
            return "Enter an algebraic expression.";
        default:
            return answerType ? `Answer type: ${answerType}.` : "";
    }
}

/**
 * Build a clear natural-language problem overview.
 */
export function composeProblemStatement(problem, steps = []) {
    const title = problem?.title || "Untitled problem";
    const bodyPlain = latexToPlainEnglish(problem?.body || "");
    const stepDescriptions = (steps || []).map((step, i) => {
        const q = latexToPlainEnglish(step.stepTitle || step.stepBody || "");
        const hint = describeAnswerType(step.answerType);
        const parts = [];
        if (q) parts.push(q);
        else parts.push(`Complete step ${i + 1}.`);
        if (hint) parts.push(hint);
        return {
            stepIndex: i + 1,
            stepId: step.id,
            question: parts.join(" "),
            rawTitle: step.stepTitle || "",
        };
    });

    const paragraphs = [];
    paragraphs.push(`Problem: ${title}.`);

    if (bodyPlain) {
        paragraphs.push(bodyPlain);
    } else if (stepDescriptions.length === 1) {
        paragraphs.push(`Your task is to ${stepDescriptions[0].question.toLowerCase()}`);
    } else if (stepDescriptions.length > 1) {
        paragraphs.push(
            `This problem has ${stepDescriptions.length} parts. Work through each step in order.`
        );
        stepDescriptions.forEach((sd) => {
            paragraphs.push(`Part ${sd.stepIndex}: ${sd.question}`);
        });
    } else {
        paragraphs.push("No step text is available for this problem.");
    }

    return {
        title,
        summary: paragraphs.join("\n\n"),
        paragraphs,
        stepDescriptions,
    };
}

export function plainEnglishAnswer(latexOrText) {
    const plain = latexToPlainEnglish(latexOrText || "");
    if (!plain) return "no answer recorded";
    return plain;
}

function describeTimelineEvent(label) {
    if (!label) return label;
    return label
        .replace(/^LLM answered: "/, 'The model answered "')
        .replace(/^Submitted: "/, 'The agent submitted "')
        .replace(/Started step/, "The agent started this step")
        .replace(/Recalled answer:/, "The agent recalled from memory:")
        .replace(/RL chose action:/, "The RL agent chose:")
        .replace(/Hint retrieval:/, "Hints were selected using:")
        .replace(/Proposition policy focus:/, "The agent focused on the idea:");
}

/**
 * Human-readable agent reasoning summary for one step.
 */
export function composeAgentReasoningSummary(stepTrace, agentType, { AGENT_TYPES } = {}) {
    const lines = [];
    const isLLM = [
        AGENT_TYPES?.LLM,
        AGENT_TYPES?.LOCAL_LLM,
        AGENT_TYPES?.LOCAL_LLM_PROP,
        AGENT_TYPES?.LOCAL_LLM_PROP_CHAIN,
        AGENT_TYPES?.LOCAL_LLM_PROP_CHAIN_TREE,
    ].filter(Boolean).includes(agentType);

    const question = latexToPlainEnglish(stepTrace.stepTitle || stepTrace.stepBody || "");
    if (question) {
        lines.push(`Question for this step: ${question}`);
    }

    if (isLLM) {
        const before = stepTrace.llmBefore || stepTrace.llmResponse;
        const after = stepTrace.llmAfter;

        if (before?.reasoning) {
            const reasoningPlain = latexToPlainEnglish(before.reasoning);
            if (reasoningPlain.length > 20) {
                lines.push(`How the model thought (summary): ${reasoningPlain.slice(0, 600)}${reasoningPlain.length > 600 ? "…" : ""}`);
            }
        }

        if (before) {
            const attemptPlain = plainEnglishAnswer(before.attempt || before.content);
            const correct = before.correct;
            if (correct === true) {
                lines.push(
                    `First attempt: The model answered "${attemptPlain}" and that was correct on the first try.`
                );
            } else if (correct === false) {
                lines.push(
                    `First attempt: The model answered "${attemptPlain}", but that was not correct.`
                );
            } else if (before.attempt || before.content) {
                lines.push(`First attempt: The model answered "${attemptPlain}".`);
            } else if (before.error) {
                lines.push(`First attempt: The model call failed (${before.error}).`);
            }
        }

        if (after?.usedHints) {
            lines.push(
                "Because the first answer was wrong, the agent read the tutoring hints for this step."
            );
        }

        if (after?.attempt != null) {
            const finalPlain = plainEnglishAnswer(after.attempt);
            const ok = after.correct ?? stepTrace.isCorrect;
            lines.push(
                `Final answer submitted: "${finalPlain}" — ${ok ? "marked correct" : "marked incorrect"}${
                    after.usedHints ? " after using hints" : ""
                }.`
            );
        }

        if (stepTrace.expectedAnswer) {
            lines.push(
                `Correct answer for this step: ${plainEnglishAnswer(stepTrace.expectedAnswer)}.`
            );
        }
    } else {
        (stepTrace.timeline || []).forEach((t) => {
            lines.push(describeTimelineEvent(t.label) || t.label);
        });

        if (stepTrace.attempt != null) {
            const ok = stepTrace.isCorrect;
            lines.push(
                `The agent answered "${plainEnglishAnswer(stepTrace.attempt)}" — ${
                    ok ? "correct" : "incorrect"
                }${stepTrace.firstTry ? " on the first try" : " after hints"}.`
            );
        }
        if (stepTrace.expectedAnswer) {
            lines.push(
                `Expected: ${plainEnglishAnswer(stepTrace.expectedAnswer)}.`
            );
        }
    }

    if (stepTrace.propPolicySuggestion?.text) {
        lines.push(
            `Proposition focus: ${latexToPlainEnglish(stepTrace.propPolicySuggestion.text)}`
        );
    }

    if (stepTrace.chainUsed?.nodes?.length) {
        const chainLines = stepTrace.chainUsed.nodes.map(
            (n, i) => `${i + 1}. ${latexToPlainEnglish(n.text || "")}`
        );
        lines.push(
            `Reasoning chain used (score ${(stepTrace.chainUsed.score ?? 0).toFixed(2)}): ${chainLines.join(" → ")}`
        );
    } else if (stepTrace.strictNoClues && (stepTrace.chainsTried?.length || 0) > 0) {
        lines.push(
            `Strict no-clue test: tried ${stepTrace.chainsTried.length} chain(s); none reached the conclusion.`
        );
    }

    return lines.filter(Boolean);
}
