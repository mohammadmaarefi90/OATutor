/**
 * Minimal PDF 1.4 writer (text, lines, rectangles) — no external dependencies.
 */

const PAGE_W = 612;
const PAGE_H = 792;
const MARGIN = 48;
const LINE_H = 14;

function escapePdfText(text) {
    return String(text || "")
        .replace(/\\/g, "\\\\")
        .replace(/\(/g, "\\(")
        .replace(/\)/g, "\\)");
}

function wrapText(text, maxChars) {
    const words = String(text || "").split(/\s+/);
    const lines = [];
    let line = "";
    for (const word of words) {
        const next = line ? `${line} ${word}` : word;
        if (next.length > maxChars && line) {
            lines.push(line);
            line = word;
        } else {
            line = next;
        }
    }
    if (line) lines.push(line);
    return lines.length ? lines : [""];
}

export default class SimplePdfWriter {
    constructor() {
        this.pages = [];
        this.y = PAGE_H - MARGIN;
        this._newPage();
    }

    _newPage() {
        this.pages.push([]);
        this.y = PAGE_H - MARGIN;
    }

    _ensureSpace(lines = 1) {
        if (this.y - lines * LINE_H < MARGIN) this._newPage();
    }

    heading(text, size = 16) {
        this._ensureSpace(2);
        this.pages[this.pages.length - 1].push({
            type: "text",
            x: MARGIN,
            y: this.y,
            size,
            font: "Helvetica-Bold",
            text: escapePdfText(text),
        });
        this.y -= size + 8;
    }

    subheading(text, size = 12) {
        this._ensureSpace(2);
        this.pages[this.pages.length - 1].push({
            type: "text",
            x: MARGIN,
            y: this.y,
            size,
            font: "Helvetica-Bold",
            text: escapePdfText(text),
        });
        this.y -= size + 6;
    }

    paragraph(text, { size = 10, indent = 0, maxChars = 92 } = {}) {
        const lines = wrapText(text, maxChars - Math.floor(indent / 4));
        for (const line of lines) {
            this._ensureSpace(1);
            this.pages[this.pages.length - 1].push({
                type: "text",
                x: MARGIN + indent,
                y: this.y,
                size,
                font: "Helvetica",
                text: escapePdfText(line),
            });
            this.y -= LINE_H;
        }
        this.y -= 4;
    }

    bullet(text, { size = 10, maxChars = 88 } = {}) {
        const lines = wrapText(text, maxChars);
        lines.forEach((line, i) => {
            this._ensureSpace(1);
            const prefix = i === 0 ? "• " : "  ";
            this.pages[this.pages.length - 1].push({
                type: "text",
                x: MARGIN + 8,
                y: this.y,
                size,
                font: "Helvetica",
                text: escapePdfText(prefix + line),
            });
            this.y -= LINE_H;
        });
    }

    tableRow(cells, { bold = false, size = 10 } = {}) {
        this._ensureSpace(1);
        const colWidths = [200, 90, 90, 90];
        let x = MARGIN;
        cells.forEach((cell, i) => {
            this.pages[this.pages.length - 1].push({
                type: "text",
                x,
                y: this.y,
                size,
                font: bold ? "Helvetica-Bold" : "Helvetica",
                text: escapePdfText(String(cell ?? "")),
            });
            x += colWidths[i] || 100;
        });
        this.y -= LINE_H + 2;
    }

    spacer(h = 12) {
        this.y -= h;
    }

    /** Draw labeled box (architecture node). */
    box(x, y, w, h, label, { fill = false, fontSize = 8 } = {}) {
        this.pages[this.pages.length - 1].push({
            type: "box",
            x,
            y,
            w,
            h,
            fill,
            label: escapePdfText(label),
            fontSize,
        });
    }

    /** Draw arrow line between two points. */
    arrow(x1, y1, x2, y2) {
        this.pages[this.pages.length - 1].push({ type: "line", x1, y1, x2, y2 });
    }

    toBlob() {
        const contentStreams = [];
        const pageObjs = [];
        const objCount = 5 + this.pages.length * 2;
        let objId = 6;

        const fontRegularId = 4;
        const fontBoldId = 5;

        for (let pi = 0; pi < this.pages.length; pi++) {
            const contentId = objId++;
            const pageId = objId++;
            pageObjs.push({ pageId, contentId });

            const cmds = ["BT"];
            let currentFont = null;
            let currentSize = 10;

            const setFont = (font, size) => {
                const key = font === "Helvetica-Bold" ? "F2" : "F1";
                if (currentFont !== key || currentSize !== size) {
                    cmds.push(`/${key} ${size} Tf`);
                    currentFont = key;
                    currentSize = size;
                }
            };

            for (const item of this.pages[pi]) {
                if (item.type === "text") {
                    setFont(item.font, item.size);
                    cmds.push(`1 0 0 1 ${item.x} ${item.y} Tm (${item.text}) Tj`);
                } else if (item.type === "line") {
                    cmds.push("ET");
                    cmds.push(
                        `${item.x1} ${item.y1} m ${item.x2} ${item.y2} l S`
                    );
                    cmds.push("BT");
                    currentFont = null;
                } else if (item.type === "box") {
                    cmds.push("ET");
                    if (item.fill) {
                        cmds.push(
                            `${item.x} ${item.y} ${item.w} ${item.h} re f`
                        );
                    } else {
                        cmds.push(
                            `${item.x} ${item.y} ${item.w} ${item.h} re S`
                        );
                    }
                    setFont("Helvetica", item.fontSize);
                    const lines = wrapText(item.label, 22);
                    let ly = item.y + item.h - 14;
                    for (const ln of lines.slice(0, 3)) {
                        cmds.push(`1 0 0 1 ${item.x + 4} ${ly} Tm (${escapePdfText(ln)}) Tj`);
                        ly -= 10;
                    }
                    cmds.push("BT");
                    currentFont = null;
                }
            }
            cmds.push("ET");
            contentStreams.push({ id: contentId, data: cmds.join("\n") });
        }

        const objects = [];
        objects.push("1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj");
        const kids = pageObjs.map((p) => `${p.pageId} 0 R`).join(" ");
        objects.push(`2 0 obj<</Type/Pages/Kids[${kids}]/Count ${this.pages.length}>>endobj`);
        objects.push(
            `${fontRegularId} 0 obj<</Type/Font/Subtype/Type1/BaseFont/Helvetica>>endobj`
        );
        objects.push(
            `${fontBoldId} 0 obj<</Type/Font/Subtype/Type1/BaseFont/Helvetica-Bold>>endobj`
        );

        for (const stream of contentStreams) {
            const body = stream.data;
            objects.push(
                `${stream.id} 0 obj<</Length ${body.length}>>stream\n${body}\nendstream`
            );
        }

        for (const p of pageObjs) {
            objects.push(
                `${p.pageId} 0 obj<</Type/Page/MediaBox[0 0 ${PAGE_W} ${PAGE_H}]/Parent 2 0 R/Contents ${p.contentId} 0 R/Resources<</Font<</F1 ${fontRegularId} 0 R/F2 ${fontBoldId} 0 R>>>>>>endobj`
            );
        }

        let pdf = "%PDF-1.4\n";
        const offsets = [0];
        objects.forEach((obj) => {
            offsets.push(pdf.length);
            pdf += obj + "\n";
        });

        const xrefPos = pdf.length;
        pdf += `xref\n0 ${objects.length + 1}\n`;
        pdf += "0000000000 65535 f \n";
        for (let i = 1; i <= objects.length; i++) {
            pdf += `${String(offsets[i]).padStart(10, "0")} 00000 n \n`;
        }
        pdf += `trailer<</Size ${objects.length + 1}/Root 1 0 R>>\n`;
        pdf += `startxref\n${xrefPos}\n%%EOF`;

        return new Blob([pdf], { type: "application/pdf" });
    }

    download(filename) {
        const blob = this.toBlob();
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = filename;
        a.style.display = "none";
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        setTimeout(() => URL.revokeObjectURL(url), 1000);
    }
}
