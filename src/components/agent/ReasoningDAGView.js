import React, { useMemo, useState, useCallback } from "react";
import {
    Box,
    Typography,
    Paper,
    Chip,
    LinearProgress,
    Divider,
    IconButton,
} from "@material-ui/core";
import CloseIcon from "@material-ui/icons/Close";
import { AGENT_META } from "../../agent/agentTypes.js";
import {
    formatTransitionLabel,
    isFlowNodeType,
    nodeTypeLabel,
    TRANSITION_META,
} from "../../agent/reasoningFlow.js";

const NODE_COLORS = {
    problem: { fill: "#e8eaf6", stroke: "#3949ab", badge: "#3949ab" },
    step: { fill: "#fff3e0", stroke: "#ef6c00", badge: "#ef6c00" },
    proposition: { fill: "#e3f2fd", stroke: "#1565c0", badge: "#1565c0" },
    "hint-proposition": { fill: "#f3e5f5", stroke: "#7b1fa2", badge: "#7b1fa2" },
    outcome: { fill: "#e8f5e9", stroke: "#2e7d32", badge: "#2e7d32" },
    "outcome-wrong": { fill: "#ffebee", stroke: "#c62828", badge: "#c62828" },
};

function wrapLines(text, maxChars = 42) {
    const words = (text || "").split(/\s+/);
    const lines = [];
    let line = "";
    for (const word of words) {
        if ((line + " " + word).trim().length > maxChars && line) {
            lines.push(line.trim());
            line = word;
        } else {
            line = (line + " " + word).trim();
        }
    }
    if (line) lines.push(line);
    return lines.slice(0, 5);
}

function nodeColors(n) {
    if (n.type === "outcome") {
        return n.isCorrect === false
            ? NODE_COLORS["outcome-wrong"]
            : NODE_COLORS.outcome;
    }
    return NODE_COLORS[n.type] || { fill: "#f5f5f5", stroke: "#757575", badge: "#757575" };
}

function nodeSubtitle(n) {
    const parts = [];
    if (n.type === "step" && n.stepIndex != null) parts.push(`Step ${n.stepIndex}`);
    if (n.type === "hint-proposition" && n.hintIndex != null) {
        parts.push(`Hint ${n.hintIndex}`);
    }
    if (n.hintTitle) parts.push(n.hintTitle.slice(0, 40));
    if (n.type === "proposition" && n.propIndex != null) {
        parts.push(`Prop ${n.propIndex}`);
    }
    if (n.visitCount > 1) parts.push(`visited ×${n.visitCount}`);
    if (n.isBranch) parts.push("branch");
    return parts.join(" · ");
}

function edgePath(from, to, branchOffset = 0) {
    const x1 = from.x + from.w / 2;
    const y1 = from.y + from.h;
    const x2 = to.x + to.w / 2;
    const y2 = to.y;
    const dy = Math.max(24, (y2 - y1) * 0.45);
    const cx = (x1 + x2) / 2 + branchOffset;
    return `M ${x1} ${y1} C ${cx} ${y1 + dy}, ${cx} ${y2 - dy}, ${x2} ${y2}`;
}

function edgeKey(e) {
    return `${e.from}→${e.to}`;
}

function truncate(text, max = 60) {
    const s = text || "";
    return s.length > max ? `${s.slice(0, max - 1)}…` : s;
}

function layoutArgumentFlow(dag, variant = "session") {
    if (!dag?.nodes?.length) return { nodes: [], edges: [], width: 400, height: 200 };

    const nodeMap = Object.fromEntries(dag.nodes.map((n) => [n.id, n]));
    const path = dag.sessionPath || dag.argumentPath || dag.path || dag.nodes.map((n) => n.id);
    const pathSet = new Set(path);

    const orderedIds = [];
    const seen = new Set();
    path.forEach((id) => {
        if (nodeMap[id] && !seen.has(id)) {
            orderedIds.push(id);
            seen.add(id);
        }
    });
    dag.nodes.forEach((n) => {
        if (!seen.has(n.id) && isFlowNodeType(n.type)) {
            orderedIds.push(n.id);
            seen.add(n.id);
        }
    });

    const nodeW = 300;
    const lineH = 14;
    const gapY = 56;
    const padX = 48;
    const padY = 40;
    const branchX = variant === "cumulative" ? 120 : 0;

    const positioned = [];
    let y = padY;

    orderedIds.forEach((id, index) => {
        const n = nodeMap[id];
        if (!n) return;
        const text = n.label || n.text || n.id;
        const subtitle = nodeSubtitle(n);
        const lines = wrapLines(text, 44);
        const extraH = subtitle ? 14 : 0;
        const h = Math.max(52, 30 + extraH + lines.length * lineH);
        const colors = nodeColors(n);
        const onPath = pathSet.has(id);
        const x = padX + (onPath ? 0 : branchX);

        positioned.push({
            ...n,
            x,
            y,
            w: nodeW,
            h,
            lines,
            subtitle,
            colors,
            flowIndex: n.flowIndex ?? (onPath ? index + 1 : null),
            onPath,
        });
        y += h + gapY;
    });

    const height = y + padY;
    const width = nodeW + padX * 2 + branchX;
    const posMap = Object.fromEntries(positioned.map((n) => [n.id, n]));

    const edges = (dag.edges || [])
        .filter((e) => posMap[e.from] && posMap[e.to])
        .map((e) => ({
            ...e,
            key: edgeKey(e),
            transitionLabel: e.transitionLabel || formatTransitionLabel(e),
        }));

    const outgoing = {};
    const incoming = {};
    edges.forEach((e) => {
        if (!outgoing[e.from]) outgoing[e.from] = [];
        outgoing[e.from].push(e);
        if (!incoming[e.to]) incoming[e.to] = [];
        incoming[e.to].push(e);
    });

    return { nodes: positioned, edges, posMap, width, height, variant, outgoing, incoming };
}

function Legend() {
    const items = [
        ...Object.entries(NODE_COLORS)
            .filter(([k]) => k !== "outcome-wrong")
            .map(([type, c]) => ({
                type: type === "outcome" ? "outcome" : type,
                stroke: c.stroke,
                label: nodeTypeLabel(type),
            })),
        { type: "outcome-wrong", stroke: NODE_COLORS["outcome-wrong"].stroke, label: "Incorrect answer" },
    ];

    return (
        <Box display="flex" flexWrap="wrap" style={{ gap: 6 }} mb={1}>
            {items.map((item) => (
                <Chip
                    key={item.type}
                    size="small"
                    label={item.label}
                    style={{
                        borderLeft: `4px solid ${item.stroke}`,
                        backgroundColor: "#fafafa",
                        fontSize: 10,
                        height: 22,
                    }}
                />
            ))}
        </Box>
    );
}

function DetailRow({ label, children }) {
    return (
        <Box mb={1}>
            <Typography variant="caption" color="textSecondary" display="block">
                {label}
            </Typography>
            <Typography variant="body2" component="div">
                {children}
            </Typography>
        </Box>
    );
}

function NodeDetailPanel({ node, layout, onClose, agentColor }) {
    if (!node) return null;

    const fullText = node.text || node.label || node.id;
    const incoming = layout.incoming[node.id] || [];
    const outgoing = layout.outgoing[node.id] || [];

    return (
        <Paper
            variant="outlined"
            style={{
                padding: 14,
                borderLeft: `4px solid ${node.colors?.stroke || agentColor}`,
                backgroundColor: "#fafafa",
            }}
        >
            <Box display="flex" alignItems="flex-start" justifyContent="space-between">
                <Box flex={1}>
                    <Chip
                        size="small"
                        label={node.typeLabel || nodeTypeLabel(node.type)}
                        style={{
                            marginBottom: 8,
                            backgroundColor: node.colors?.fill,
                            color: node.colors?.stroke,
                            fontWeight: 600,
                        }}
                    />
                    <Typography variant="subtitle2" gutterBottom>
                        Proposition / argument focus
                    </Typography>
                </Box>
                <IconButton size="small" onClick={onClose} aria-label="Close">
                    <CloseIcon fontSize="small" />
                </IconButton>
            </Box>

            <Typography variant="body2" paragraph style={{ whiteSpace: "pre-wrap", lineHeight: 1.5 }}>
                {fullText}
            </Typography>

            <Divider style={{ margin: "8px 0" }} />

            {node.type === "proposition" && node.sourceField && (
                <DetailRow label="Extracted from">{node.sourceField}</DetailRow>
            )}
            {node.stepId && <DetailRow label="Step ID">{node.stepId}</DetailRow>}
            {node.hintId && <DetailRow label="Hint ID">{node.hintId}</DetailRow>}
            {node.hintTitle && <DetailRow label="Hint title">{node.hintTitle}</DetailRow>}
            {node.type === "outcome" && (
                <DetailRow label="Submission result">
                    {node.isCorrect ? "Correct" : "Incorrect"} — {node.attempt || "—"}
                </DetailRow>
            )}
            {node.visitCount > 1 && (
                <DetailRow label="Times visited (cumulative)">{node.visitCount}</DetailRow>
            )}

            {(incoming.length > 0 || outgoing.length > 0) && (
                <>
                    <Typography variant="caption" color="textSecondary" display="block" gutterBottom>
                        Connected transitions — click an edge in the graph for P(to|from)
                    </Typography>
                    {incoming.map((e) => (
                        <Typography key={`in-${e.key}`} variant="caption" display="block">
                            ← from {truncate(layout.posMap[e.from]?.text || e.from)} (
                            {Math.round((e.probability ?? 1) * 100)}%)
                        </Typography>
                    ))}
                    {outgoing.map((e) => (
                        <Typography key={`out-${e.key}`} variant="caption" display="block">
                            → to {truncate(layout.posMap[e.to]?.text || e.to)} (
                            {Math.round((e.probability ?? 1) * 100)}%)
                        </Typography>
                    ))}
                </>
            )}
        </Paper>
    );
}

function EdgeDetailPanel({ edge, layout, onClose, agentColor }) {
    if (!edge) return null;

    const meta = TRANSITION_META[edge.type] || TRANSITION_META.flow;
    const fromNode = layout.posMap[edge.from];
    const toNode = layout.posMap[edge.to];
    const siblings = layout.outgoing[edge.from] || [edge];
    const totalCount = siblings.reduce((s, e) => s + (e.count || 1), 0);
    const prob = edge.probability ?? (totalCount > 0 ? (edge.count || 1) / totalCount : 1);
    const probPct = Math.round(prob * 100);

    return (
        <Paper
            variant="outlined"
            style={{
                padding: 14,
                borderLeft: `4px solid ${agentColor}`,
                backgroundColor: "#fff8f0",
            }}
        >
            <Box display="flex" alignItems="flex-start" justifyContent="space-between">
                <Box flex={1}>
                    <Chip
                        size="small"
                        label={meta.label}
                        style={{ marginBottom: 8, fontWeight: 600 }}
                    />
                    <Typography variant="subtitle2" gutterBottom>
                        Transition probability
                    </Typography>
                </Box>
                <IconButton size="small" onClick={onClose} aria-label="Close">
                    <CloseIcon fontSize="small" />
                </IconButton>
            </Box>

            <Box mb={2}>
                <Box display="flex" justifyContent="space-between" alignItems="baseline" mb={0.5}>
                    <Typography variant="h5" style={{ color: agentColor, fontWeight: 700 }}>
                        P(to|from) = {probPct}%
                    </Typography>
                    <Typography variant="caption" color="textSecondary">
                        {edge.count || 1} / {totalCount} transitions
                    </Typography>
                </Box>
                <LinearProgress
                    variant="determinate"
                    value={probPct}
                    style={{ height: 8, borderRadius: 4 }}
                />
            </Box>

            <DetailRow label="From (source proposition)">
                {fromNode?.text || fromNode?.label || edge.from}
            </DetailRow>
            <DetailRow label="To (target proposition)">
                {toNode?.text || toNode?.label || edge.to}
            </DetailRow>
            <DetailRow label="Transition type">{meta.description}</DetailRow>
            {edge.label && <DetailRow label="Agent action / label">{edge.label}</DetailRow>}
            {edge.action && <DetailRow label="Action code">{edge.action}</DetailRow>}

            {siblings.length > 1 && (
                <>
                    <Divider style={{ margin: "10px 0" }} />
                    <Typography variant="caption" color="textSecondary" display="block" gutterBottom>
                        All outgoing transitions from this node (must sum to 100%)
                    </Typography>
                    {siblings
                        .slice()
                        .sort((a, b) => (b.probability ?? 0) - (a.probability ?? 0))
                        .map((s) => {
                            const sProb = s.probability ?? (s.count || 1) / totalCount;
                            const isSelected = s.key === edge.key;
                            return (
                                <Box
                                    key={s.key}
                                    display="flex"
                                    alignItems="center"
                                    mb={0.75}
                                    p={0.75}
                                    style={{
                                        borderRadius: 4,
                                        backgroundColor: isSelected ? "#fff3e0" : "transparent",
                                    }}
                                >
                                    <Box flex={1} mr={1}>
                                        <Typography variant="caption" display="block">
                                            → {truncate(layout.posMap[s.to]?.text || s.to, 50)}
                                        </Typography>
                                        {s.label && (
                                            <Typography variant="caption" color="textSecondary">
                                                {s.label}
                                            </Typography>
                                        )}
                                    </Box>
                                    <Typography
                                        variant="caption"
                                        style={{ fontWeight: isSelected ? 700 : 400, minWidth: 36 }}
                                    >
                                        {Math.round(sProb * 100)}%
                                    </Typography>
                                </Box>
                            );
                        })}
                </>
            )}
        </Paper>
    );
}

function StepTraceSummary({ stepTraces }) {
    if (!stepTraces?.length) return null;

    return (
        <Box mt={1.5}>
            <Typography variant="caption" color="textSecondary" display="block" gutterBottom>
                Step-by-step trace
            </Typography>
            {stepTraces.map((t, i) => (
                <Box
                    key={t.stepId || i}
                    mb={0.75}
                    p={1}
                    style={{
                        backgroundColor: t.result?.isCorrect ? "#f1f8e9" : "#fff8e1",
                        borderRadius: 4,
                        borderLeft: `3px solid ${t.result?.isCorrect ? "#689f38" : "#ffa000"}`,
                    }}
                >
                    <Typography variant="caption" display="block" style={{ fontWeight: 600 }}>
                        Step {t.stepIndex}: {t.stepLabel?.slice(0, 80)}
                    </Typography>
                    {t.actions?.length > 0 && (
                        <Typography variant="caption" color="textSecondary" display="block">
                            Actions: {t.actions.map((a) => a.friendly || a.action).join(" → ")}
                        </Typography>
                    )}
                    {t.result && (
                        <Typography variant="caption" display="block">
                            {t.result.isCorrect ? "✓" : "✗"} {t.result.attemptText || t.result.attempt}
                        </Typography>
                    )}
                </Box>
            ))}
        </Box>
    );
}

export default function ReasoningDAGView({ dag, title, agentType, variant = "session" }) {
    const layout = useMemo(() => layoutArgumentFlow(dag, variant), [dag, variant]);
    const color = agentType ? AGENT_META[agentType]?.color : "#666";
    const markerId = `arrow-${agentType || "default"}-${variant}`;

    const [selection, setSelection] = useState(null);
    const [hovered, setHovered] = useState(null);

    const clearSelection = useCallback(() => setSelection(null), []);

    const selectNode = useCallback((nodeId) => {
        setSelection({ kind: "node", id: nodeId });
    }, []);

    const selectEdge = useCallback((edgeKeyVal) => {
        setSelection({ kind: "edge", id: edgeKeyVal });
    }, []);

    if (!dag?.nodes?.length) {
        return (
            <Typography variant="body2" color="textSecondary">
                No reasoning graph data yet. Run evaluation on problems after training.
            </Typography>
        );
    }

    const selectedNode =
        selection?.kind === "node" ? layout.posMap[selection.id] : null;
    const selectedEdge =
        selection?.kind === "edge"
            ? layout.edges.find((e) => e.key === selection.id)
            : null;

    const isNodeConnected = (nodeId) => {
        if (!selectedNode) return false;
        return selectedNode.id === nodeId;
    };

    const isEdgeHighlighted = (e) => {
        if (selectedEdge) return e.key === selectedEdge.key;
        if (selectedNode) return e.from === selectedNode.id || e.to === selectedNode.id;
        if (hovered?.kind === "edge") return e.key === hovered.id;
        if (hovered?.kind === "node") return e.from === hovered.id || e.to === hovered.id;
        return false;
    };

    const hasBranchProb = layout.edges.some(
        (e) => e._showProb !== false && e.probability != null && e.probability < 1
    );

    return (
        <Box>
            {title && (
                <Typography variant="subtitle2" gutterBottom style={{ color }}>
                    {title}
                </Typography>
            )}

            <Legend />

            <Typography variant="caption" color="textSecondary" display="block" gutterBottom>
                Click a node to inspect the proposition; click an edge to see P(to|from) and competing
                transitions.
            </Typography>

            <Box display="flex" flexDirection={{ xs: "column", md: "row" }} style={{ gap: 12 }}>
                <Paper
                    variant="outlined"
                    style={{ overflow: "auto", padding: 12, maxHeight: 560, flex: 1, minWidth: 0 }}
                >
                    <svg width={layout.width} height={layout.height} style={{ display: "block" }}>
                        <defs>
                            <marker
                                id={markerId}
                                markerWidth="8"
                                markerHeight="8"
                                refX="6"
                                refY="3"
                                orient="auto"
                            >
                                <path d="M0,0 L0,6 L8,3 z" fill="#555" />
                            </marker>
                            <marker
                                id={`${markerId}-hi`}
                                markerWidth="8"
                                markerHeight="8"
                                refX="6"
                                refY="3"
                                orient="auto"
                            >
                                <path d="M0,0 L0,6 L8,3 z" fill={color} />
                            </marker>
                        </defs>

                        {layout.edges.map((e, i) => {
                            const from = layout.posMap[e.from];
                            const to = layout.posMap[e.to];
                            if (!from || !to) return null;

                            const branchOffset = !from.onPath || !to.onPath ? 40 : 0;
                            const pathD = edgePath(from, to, branchOffset);
                            const highlighted = isEdgeHighlighted(e);
                            const selected = selectedEdge?.key === e.key;
                            const x1 = from.x + from.w / 2;
                            const y1 = from.y + from.h;
                            const x2 = to.x + to.w / 2;
                            const y2 = to.y;
                            const labelX = (x1 + x2) / 2 + branchOffset * 0.5 + 12;
                            const labelY = (y1 + y2) / 2;
                            const label = e.transitionLabel || formatTransitionLabel(e);
                            const labelW = Math.min(220, label.length * 5.2 + 12);
                            const meta = TRANSITION_META[e.type] || TRANSITION_META.flow;
                            const probPct =
                                e.probability != null ? Math.round(e.probability * 100) : null;

                            return (
                                <g
                                    key={`${e.from}-${e.to}-${i}`}
                                    style={{ cursor: "pointer" }}
                                    onClick={() => selectEdge(e.key)}
                                    onMouseEnter={() => setHovered({ kind: "edge", id: e.key })}
                                    onMouseLeave={() => setHovered(null)}
                                >
                                    <path
                                        d={pathD}
                                        fill="none"
                                        stroke="transparent"
                                        strokeWidth={16}
                                    />
                                    <path
                                        d={pathD}
                                        fill="none"
                                        stroke={
                                            selected || highlighted
                                                ? color
                                                : e._showProb !== false && e.probability < 1
                                                  ? "#e65100"
                                                  : "#666"
                                        }
                                        strokeWidth={selected ? 3.5 : highlighted ? 3 : e.count > 1 ? 2.5 : 1.5}
                                        strokeDasharray={e.type === "via-hint" ? "4 3" : undefined}
                                        markerEnd={`url(#${selected || highlighted ? `${markerId}-hi` : markerId})`}
                                    />
                                    <rect
                                        x={labelX - 4}
                                        y={labelY - 18}
                                        width={labelW}
                                        height={probPct != null ? 40 : 34}
                                        rx={4}
                                        fill={selected ? "#fff3e0" : "#fff"}
                                        stroke={selected ? color : highlighted ? "#bbb" : "#ddd"}
                                        strokeWidth={selected ? 2 : 1}
                                    />
                                    <text x={labelX} y={labelY - 6} fontSize={8} fill="#888">
                                        {meta.short}
                                        {probPct != null ? ` · P=${probPct}%` : ""}
                                    </text>
                                    <text x={labelX} y={labelY + 6} fontSize={9} fill="#222">
                                        {label.length > 48 ? `${label.slice(0, 46)}…` : label}
                                    </text>
                                    {probPct != null && (
                                        <text x={labelX} y={labelY + 18} fontSize={8} fill={color}>
                                            click for details
                                        </text>
                                    )}
                                </g>
                            );
                        })}

                        {layout.nodes.map((n) => {
                            const selected = selectedNode?.id === n.id;
                            const connected = isNodeConnected(n.id);
                            const hoveredNode = hovered?.kind === "node" && hovered.id === n.id;

                            return (
                                <g
                                    key={n.id}
                                    style={{ cursor: "pointer" }}
                                    onClick={() => selectNode(n.id)}
                                    onMouseEnter={() => setHovered({ kind: "node", id: n.id })}
                                    onMouseLeave={() => setHovered(null)}
                                >
                                    <rect
                                        x={n.x}
                                        y={n.y}
                                        width={n.w}
                                        height={n.h}
                                        rx={8}
                                        fill={
                                            selected
                                                ? n.colors.fill
                                                : connected || hoveredNode
                                                  ? n.colors.fill
                                                  : n.colors.fill
                                        }
                                        stroke={selected || connected || hoveredNode ? color : n.colors.stroke}
                                        strokeWidth={selected ? 3 : connected || hoveredNode ? 2.5 : n.onPath === false ? 1.5 : 2}
                                        strokeDasharray={n.onPath === false && !selected ? "5 3" : undefined}
                                        opacity={selectedNode && !selected && !connected ? 0.55 : 1}
                                    />
                                    {n.flowIndex != null && (
                                        <>
                                            <circle
                                                cx={n.x + 18}
                                                cy={n.y + 16}
                                                r={11}
                                                fill={selected ? color : n.colors.badge}
                                            />
                                            <text
                                                x={n.x + 18}
                                                y={n.y + 20}
                                                fontSize={10}
                                                fill="#fff"
                                                textAnchor="middle"
                                                fontWeight="bold"
                                            >
                                                {n.flowIndex}
                                            </text>
                                        </>
                                    )}
                                    <text
                                        x={n.x + (n.flowIndex != null ? 36 : 12)}
                                        y={n.y + 14}
                                        fontSize={9}
                                        fill={n.colors.stroke}
                                        fontWeight="600"
                                    >
                                        {n.typeLabel || nodeTypeLabel(n.type)}
                                    </text>
                                    {n.subtitle && (
                                        <text
                                            x={n.x + (n.flowIndex != null ? 36 : 12)}
                                            y={n.y + 26}
                                            fontSize={8}
                                            fill="#777"
                                        >
                                            {n.subtitle}
                                        </text>
                                    )}
                                    {n.lines.map((line, li) => (
                                        <text
                                            key={li}
                                            x={n.x + 12}
                                            y={n.y + (n.subtitle ? 40 : 32) + li * 14}
                                            fontSize={10}
                                            fill="#222"
                                        >
                                            {line}
                                        </text>
                                    ))}
                                </g>
                            );
                        })}
                    </svg>
                </Paper>

                {(selectedNode || selectedEdge) && (
                    <Box style={{ width: "100%", maxWidth: 340, flexShrink: 0 }}>
                        {selectedNode && (
                            <NodeDetailPanel
                                node={selectedNode}
                                layout={layout}
                                onClose={clearSelection}
                                agentColor={color}
                            />
                        )}
                        {selectedEdge && (
                            <EdgeDetailPanel
                                edge={selectedEdge}
                                layout={layout}
                                onClose={clearSelection}
                                agentColor={color}
                            />
                        )}
                    </Box>
                )}
            </Box>

            <StepTraceSummary stepTraces={dag.stepTraces} />

            <Box mt={1}>
                <Typography variant="caption" color="textSecondary" display="block">
                    {variant === "cumulative"
                        ? "Cumulative graph: all observed transitions. Select edges to compare P(to|from) against alternative branches."
                        : "Session graph: one run through the argument. Edge labels show transition type; click for full probability breakdown when available."}
                </Typography>
                {hasBranchProb && (
                    <Typography variant="caption" color="textSecondary" display="block">
                        Orange edges indicate branching transitions with empirical P(to|from).
                    </Typography>
                )}
            </Box>
        </Box>
    );
}
