import React from "react";
import {
    Box,
    Button,
    Collapse,
    FormControl,
    Grid,
    InputLabel,
    MenuItem,
    Paper,
    Select,
    TextField,
    Typography,
    Chip,
    FormControlLabel,
    Checkbox,
} from "@material-ui/core";
import SettingsIcon from "@material-ui/icons/Settings";
import ExpandMoreIcon from "@material-ui/icons/ExpandMore";
import ExpandLessIcon from "@material-ui/icons/ExpandLess";
import {
    DEFAULT_LLM_SETTINGS,
    LLM_PROVIDER,
    SKILL_HINT_MODES,
    PROP_HINT_MODES,
    PROP_TRAINING_HINT_MODES,
    PROP_APS_MODES,
    SKILL_BKT_BACKEND,
    loadLLMSettings,
    saveLLMSettings,
} from "../../agent/llm/llmSettings.js";
import { probePyBktServer } from "../../agent/llm/pyBKTClient.js";
import {
    SKILL_HINT_MODE_META,
    PROP_HINT_MODE_META,
} from "../../agent/llm/beliefRetrieval.js";
import { PROP_TRAINING_HINT_MODE_META } from "../../agent/llm/propositionTrainingPath.js";
import { PROP_APS_MODE_META } from "../../agent/llm/propositionSegmentation.js";
import { probeLocalLLMServer, resetOpenAIClient } from "../../agent/llm/llmClient.js";

class LLMSettingsPanel extends React.Component {
    constructor(props) {
        super(props);
        this.state = {
            open: props.defaultOpen || false,
            settings: { ...DEFAULT_LLM_SETTINGS },
            probeStatus: null,
            probing: false,
            pyBktProbeStatus: null,
            pyBktProbing: false,
            savedMessage: null,
        };
    }

    componentDidMount() {
        this.loadSettings();
    }

    loadSettings = async () => {
        const { browserStorage } = this.props;
        const settings = await loadLLMSettings(browserStorage);
        this.setState({ settings });
        try {
            localStorage.setItem("oatutor-llm-settings", JSON.stringify(settings));
        } catch {
            /* ignore */
        }
    };

    handleChange = (field) => (event) => {
        let value = event.target.value;
        if (field === "requestTimeoutMs" || field === "maxBeliefsInPrompt") {
            value = Number(value) || DEFAULT_LLM_SETTINGS[field];
        }
        if (
            field === "propPlanningMaxPivots" ||
            field === "propPlanningMaxChains" ||
            field === "propPlanningMaxHints" ||
            field === "propTrainingMaxHintsPerStep" ||
            field === "propApsMaxPropositions"
        ) {
            value = Number(value) || DEFAULT_LLM_SETTINGS[field];
        }
        this.setState((prev) => ({
            settings: { ...prev.settings, [field]: value },
            savedMessage: null,
        }));
    };

    handleCheckboxChange = (field) => (event) => {
        event.stopPropagation();
        const value = event.target.checked;
        this.setState(
            (prev) => ({
                settings: { ...prev.settings, [field]: value },
                savedMessage: null,
            }),
            () => {
                if (field === "propPlanningEnabled") {
                    this.persistSettings(`Hint planning ${value ? "enabled" : "disabled"}.`);
                }
                if (field === "propApsEnabled") {
                    this.persistSettings(`Proposition segmentation (APS) ${value ? "enabled" : "disabled"}.`);
                }
            }
        );
    };

    persistSettings = async (successMessage = "Settings saved.") => {
        const { browserStorage, onSettingsChange } = this.props;
        const { settings } = this.state;
        try {
            const merged = await saveLLMSettings(browserStorage, settings);
            try {
                localStorage.setItem("oatutor-llm-settings", JSON.stringify(merged));
            } catch {
                /* ignore */
            }
            resetOpenAIClient();
            this.setState({ settings: merged, savedMessage: successMessage });
            onSettingsChange?.(merged);
        } catch (err) {
            this.setState({
                savedMessage: `Could not save settings: ${err.message || "unknown error"}`,
            });
        }
    };

    handleSave = async () => {
        await this.persistSettings("Settings saved.");
    };

    handleReset = () => {
        this.setState({ settings: { ...DEFAULT_LLM_SETTINGS }, savedMessage: null });
    };

    handlePyBktProbe = async () => {
        const { settings } = this.state;
        this.setState({ pyBktProbing: true, pyBktProbeStatus: null });
        const result = await probePyBktServer(settings);
        this.setState({
            pyBktProbing: false,
            pyBktProbeStatus: result.ok
                ? { ok: true, text: result.message }
                : { ok: false, text: `${result.message}. ${result.hint || ""}` },
        });
    };

    handleProbe = async () => {
        const { settings } = this.state;
        this.setState({ probing: true, probeStatus: null });
        const result = await probeLocalLLMServer(settings);
        let nextSettings = settings;
        if (result.ok && result.suggestedModel && !result.modelMatch) {
            nextSettings = { ...settings, localModel: result.suggestedModel };
        }
        this.setState({
            probing: false,
            settings: nextSettings,
            probeStatus: result.ok
                ? {
                      ok: result.modelMatch !== false,
                      text: result.message || `Connected (${result.modelIds?.length || 0} model(s))`,
                  }
                : { ok: false, text: result.message || "Unreachable" },
        });
    };

    render() {
        const { compact } = this.props;
        const { open, settings, probeStatus, probing, pyBktProbeStatus, pyBktProbing, savedMessage } =
            this.state;

        return (
            <Paper variant="outlined" style={{ padding: compact ? 12 : 16, marginBottom: 16 }}>
                <Box
                    display="flex"
                    alignItems="center"
                    justifyContent="space-between"
                    style={{ cursor: "pointer" }}
                    onClick={() => this.setState({ open: !open })}
                >
                    <Box display="flex" alignItems="center">
                        <SettingsIcon style={{ marginRight: 8, color: "#e65100" }} />
                        <Typography variant="subtitle1">LLM connection settings</Typography>
                        <Chip
                            size="small"
                            label={
                                settings.provider === LLM_PROVIDER.LOCAL_GPT_OSS
                                    ? "Local GPT-OSS"
                                    : "Cloud GPT-4"
                            }
                            style={{ marginLeft: 12, backgroundColor: "#fff3e0" }}
                        />
                    </Box>
                    {open ? <ExpandLessIcon /> : <ExpandMoreIcon />}
                </Box>

                <Collapse in={open}>
                    <Typography variant="body2" color="textSecondary" paragraph style={{ marginTop: 12 }}>
                        Configure gpt-oss on llama.cpp (OpenAI-compatible API). Reasoning
                        effort is sent via <code>chat_template_kwargs</code> (requires server{" "}
                        <code>--jinja</code>). Do not cap <code>max_tokens</code> — reasoning
                        models emit <code>reasoning_content</code> then <code>content</code>.
                    </Typography>

                    <Grid container spacing={2}>
                        <Grid item xs={12} sm={6}>
                            <FormControl fullWidth variant="outlined" size="small">
                                <InputLabel>Provider</InputLabel>
                                <Select
                                    value={settings.provider}
                                    onChange={this.handleChange("provider")}
                                    label="Provider"
                                >
                                    <MenuItem value={LLM_PROVIDER.LOCAL_GPT_OSS}>
                                        Local GPT-OSS (llama.cpp)
                                    </MenuItem>
                                    <MenuItem value={LLM_PROVIDER.CLOUD_GPT4}>
                                        Cloud GPT-4 (AWS hint endpoint)
                                    </MenuItem>
                                </Select>
                            </FormControl>
                        </Grid>

                        {settings.provider === LLM_PROVIDER.LOCAL_GPT_OSS && (
                            <>
                                <Grid item xs={12} sm={6}>
                                    <TextField
                                        fullWidth
                                        size="small"
                                        variant="outlined"
                                        label="Base URL"
                                        value={settings.localBaseUrl}
                                        onChange={this.handleChange("localBaseUrl")}
                                        helperText="OpenAI-compatible API root (include /v1)"
                                    />
                                </Grid>
                                <Grid item xs={12} sm={4}>
                                    <TextField
                                        fullWidth
                                        size="small"
                                        variant="outlined"
                                        label="Model name"
                                        value={settings.localModel}
                                        onChange={this.handleChange("localModel")}
                                    />
                                </Grid>
                                <Grid item xs={12} sm={4}>
                                    <FormControl fullWidth variant="outlined" size="small">
                                        <InputLabel>Reasoning effort</InputLabel>
                                        <Select
                                            value={settings.reasoningEffort}
                                            onChange={this.handleChange("reasoningEffort")}
                                            label="Reasoning effort"
                                        >
                                            {["low", "medium", "high"].map((level) => (
                                                <MenuItem key={level} value={level}>
                                                    {level}
                                                </MenuItem>
                                            ))}
                                        </Select>
                                    </FormControl>
                                </Grid>
                                <Grid item xs={12} sm={4}>
                                    <TextField
                                        fullWidth
                                        size="small"
                                        variant="outlined"
                                        label="Timeout (ms)"
                                        type="number"
                                        value={settings.requestTimeoutMs}
                                        onChange={this.handleChange("requestTimeoutMs")}
                                        helperText="Wall-clock limit per LLM call"
                                    />
                                </Grid>
                                <Grid item xs={12} sm={4}>
                                    <TextField
                                        fullWidth
                                        size="small"
                                        variant="outlined"
                                        label="Max beliefs in prompt"
                                        type="number"
                                        value={settings.maxBeliefsInPrompt}
                                        onChange={this.handleChange("maxBeliefsInPrompt")}
                                        helperText="Training hints injected per step"
                                    />
                                </Grid>

                                <Grid item xs={12} sm={6}>
                                    <FormControl fullWidth variant="outlined" size="small">
                                        <InputLabel>Skill BKT backend (GPT-OSS only)</InputLabel>
                                        <Select
                                            value={
                                                settings.skillBktBackend ||
                                                SKILL_BKT_BACKEND.CLASSIC
                                            }
                                            onChange={this.handleChange("skillBktBackend")}
                                            label="Skill BKT backend (GPT-OSS only)"
                                        >
                                            <MenuItem value={SKILL_BKT_BACKEND.CLASSIC}>
                                                Classic (in-browser BKT-brain)
                                            </MenuItem>
                                            <MenuItem value={SKILL_BKT_BACKEND.PYBKT}>
                                                pyBKT (local CAHLR server)
                                            </MenuItem>
                                        </Select>
                                        <Typography variant="caption" color="textSecondary">
                                            pyBKT uses{" "}
                                            <code>./scripts/serve-pybkt.sh</code> on port 8090.
                                            Prop BKT agent unchanged.
                                        </Typography>
                                    </FormControl>
                                </Grid>
                                <Grid item xs={12} sm={6}>
                                    <TextField
                                        fullWidth
                                        size="small"
                                        variant="outlined"
                                        label="pyBKT service URL"
                                        value={settings.pyBktBaseUrl || "http://127.0.0.1:8090"}
                                        onChange={this.handleChange("pyBktBaseUrl")}
                                        disabled={
                                            settings.skillBktBackend !== SKILL_BKT_BACKEND.PYBKT
                                        }
                                    />
                                </Grid>

                                <Grid item xs={12}>
                                    <Typography variant="subtitle2" style={{ marginTop: 4 }}>
                                        Hint retrieval mode (compare strategies)
                                    </Typography>
                                    <Typography variant="caption" color="textSecondary" display="block">
                                        Choose how hints are picked for the LLM prompt. Run the same
                                        evaluation with different modes to see which performs better.
                                    </Typography>
                                </Grid>
                                <Grid item xs={12} sm={6}>
                                    <FormControl fullWidth variant="outlined" size="small">
                                        <InputLabel>GPT-OSS (skill BKT)</InputLabel>
                                        <Select
                                            value={
                                                settings.skillHintRetrieval ||
                                                SKILL_HINT_MODES.RECENCY
                                            }
                                            onChange={this.handleChange("skillHintRetrieval")}
                                            label="GPT-OSS (skill BKT)"
                                        >
                                            {Object.values(SKILL_HINT_MODES).map((mode) => (
                                                <MenuItem key={mode} value={mode}>
                                                    {SKILL_HINT_MODE_META[mode]?.label || mode}
                                                </MenuItem>
                                            ))}
                                        </Select>
                                        <Typography variant="caption" color="textSecondary">
                                            {SKILL_HINT_MODE_META[settings.skillHintRetrieval]
                                                ?.description || ""}
                                        </Typography>
                                    </FormControl>
                                </Grid>
                                <Grid item xs={12} sm={6}>
                                    <FormControl fullWidth variant="outlined" size="small">
                                        <InputLabel>Prop BKT agent</InputLabel>
                                        <Select
                                            value={
                                                settings.propHintRetrieval ||
                                                PROP_HINT_MODES.RELEVANCE
                                            }
                                            onChange={this.handleChange("propHintRetrieval")}
                                            label="Prop BKT agent"
                                        >
                                            {Object.values(PROP_HINT_MODES).map((mode) => (
                                                <MenuItem key={mode} value={mode}>
                                                    {PROP_HINT_MODE_META[mode]?.label || mode}
                                                </MenuItem>
                                            ))}
                                        </Select>
                                        <Typography variant="caption" color="textSecondary">
                                            {PROP_HINT_MODE_META[settings.propHintRetrieval]
                                                ?.description || ""}
                                        </Typography>
                                    </FormControl>
                                </Grid>

                                <Grid item xs={12}>
                                    <Typography variant="subtitle2" style={{ marginTop: 4 }}>
                                        Hint planning (Prop BKT + Tree agents)
                                    </Typography>
                                    <Typography variant="caption" color="textSecondary" display="block">
                                        When enabled, the planner suggests pivot ideas, relevant trained
                                        hints, and one chain per pivot — especially for strict no-clue
                                        evaluation.
                                    </Typography>
                                </Grid>
                                <Grid item xs={12}>
                                    <FormControlLabel
                                        control={
                                            <Checkbox
                                                checked={!!settings.propPlanningEnabled}
                                                onChange={this.handleCheckboxChange("propPlanningEnabled")}
                                                onClick={(e) => e.stopPropagation()}
                                                color="primary"
                                            />
                                        }
                                        label="Enable hint planning module"
                                        onClick={(e) => e.stopPropagation()}
                                    />
                                    <Typography variant="caption" color="textSecondary" display="block">
                                        Applies to Propositional BKT and Prop BKT Chain Tree agents.
                                        Saves immediately when toggled — then train one of those agents.
                                    </Typography>
                                </Grid>
                                {settings.propPlanningEnabled ? (
                                    <>
                                        <Grid item xs={12} sm={4}>
                                            <TextField
                                                fullWidth
                                                size="small"
                                                variant="outlined"
                                                label="Max pivot ideas"
                                                type="number"
                                                value={settings.propPlanningMaxPivots ?? 3}
                                                onChange={this.handleChange("propPlanningMaxPivots")}
                                            />
                                        </Grid>
                                        <Grid item xs={12} sm={4}>
                                            <TextField
                                                fullWidth
                                                size="small"
                                                variant="outlined"
                                                label="Max chains per step"
                                                type="number"
                                                value={settings.propPlanningMaxChains ?? 5}
                                                onChange={this.handleChange("propPlanningMaxChains")}
                                            />
                                        </Grid>
                                        <Grid item xs={12} sm={4}>
                                            <TextField
                                                fullWidth
                                                size="small"
                                                variant="outlined"
                                                label="Max relevant hints"
                                                type="number"
                                                value={settings.propPlanningMaxHints ?? 8}
                                                onChange={this.handleChange("propPlanningMaxHints")}
                                            />
                                        </Grid>
                                    </>
                                ) : null}

                                <Grid item xs={12}>
                                    <Typography variant="subtitle2" style={{ marginTop: 4 }}>
                                        Training write path (Prop BKT + Chain + Tree)
                                    </Typography>
                                    <Typography variant="caption" color="textSecondary" display="block">
                                        How hints are revealed when the LLM fails during training.
                                        Planner-guided reveals targeted hints and retries the LLM as beliefs update.
                                    </Typography>
                                </Grid>
                                <Grid item xs={12} sm={6}>
                                    <FormControl fullWidth variant="outlined" size="small">
                                        <InputLabel>Training hint reveal</InputLabel>
                                        <Select
                                            value={
                                                settings.propTrainingHintMode ||
                                                PROP_TRAINING_HINT_MODES.PLANNER_GUIDED
                                            }
                                            onChange={this.handleChange("propTrainingHintMode")}
                                            label="Training hint reveal"
                                        >
                                            {Object.values(PROP_TRAINING_HINT_MODES).map((mode) => (
                                                <MenuItem key={mode} value={mode}>
                                                    {PROP_TRAINING_HINT_MODE_META[mode]?.label || mode}
                                                </MenuItem>
                                            ))}
                                        </Select>
                                        <Typography variant="caption" color="textSecondary">
                                            {PROP_TRAINING_HINT_MODE_META[settings.propTrainingHintMode]
                                                ?.description || ""}
                                        </Typography>
                                    </FormControl>
                                </Grid>
                                <Grid item xs={12} sm={6}>
                                    <TextField
                                        fullWidth
                                        size="small"
                                        variant="outlined"
                                        label="Max hints per step (partial modes)"
                                        type="number"
                                        value={settings.propTrainingMaxHintsPerStep ?? 8}
                                        onChange={this.handleChange("propTrainingMaxHintsPerStep")}
                                    />
                                </Grid>
                                <Grid item xs={12} sm={6}>
                                    <FormControlLabel
                                        control={
                                            <Checkbox
                                                checked={settings.propTrainingRetryLlm !== false}
                                                onChange={this.handleCheckboxChange("propTrainingRetryLlm")}
                                                onClick={(e) => e.stopPropagation()}
                                                color="primary"
                                            />
                                        }
                                        label="Retry LLM after each revealed hint"
                                        onClick={(e) => e.stopPropagation()}
                                    />
                                </Grid>
                                <Grid item xs={12} sm={6}>
                                    <FormControlLabel
                                        control={
                                            <Checkbox
                                                checked={settings.propTrainingAllowAnswerKey !== false}
                                                onChange={this.handleCheckboxChange("propTrainingAllowAnswerKey")}
                                                onClick={(e) => e.stopPropagation()}
                                                color="primary"
                                            />
                                        }
                                        label="Allow step answer key fallback"
                                        onClick={(e) => e.stopPropagation()}
                                    />
                                </Grid>

                                <Grid item xs={12}>
                                    <Typography variant="subtitle2" style={{ marginTop: 4 }}>
                                        Proposition segmentation — APS (Prop BKT + Chain + Tree)
                                    </Typography>
                                    <Typography variant="caption" color="textSecondary" display="block">
                                        Optional layer that splits step and hint text into finer atomic
                                        propositions before BKT. No fine-tuning required for heuristic or
                                        LLM-prompt modes.
                                    </Typography>
                                </Grid>
                                <Grid item xs={12}>
                                    <FormControlLabel
                                        control={
                                            <Checkbox
                                                checked={!!settings.propApsEnabled}
                                                onChange={this.handleCheckboxChange("propApsEnabled")}
                                                onClick={(e) => e.stopPropagation()}
                                                color="primary"
                                            />
                                        }
                                        label="Enable proposition segmentation (APS)"
                                        onClick={(e) => e.stopPropagation()}
                                    />
                                </Grid>
                                {settings.propApsEnabled ? (
                                    <>
                                        <Grid item xs={12} sm={6}>
                                            <FormControl fullWidth variant="outlined" size="small">
                                                <InputLabel>APS mode</InputLabel>
                                                <Select
                                                    value={
                                                        settings.propApsMode ||
                                                        PROP_APS_MODES.HEURISTIC
                                                    }
                                                    onChange={this.handleChange("propApsMode")}
                                                    label="APS mode"
                                                >
                                                    {Object.values(PROP_APS_MODES).map((mode) => (
                                                        <MenuItem key={mode} value={mode}>
                                                            {PROP_APS_MODE_META[mode]?.label || mode}
                                                        </MenuItem>
                                                    ))}
                                                </Select>
                                                <Typography variant="caption" color="textSecondary">
                                                    {PROP_APS_MODE_META[settings.propApsMode]
                                                        ?.description || ""}
                                                </Typography>
                                            </FormControl>
                                        </Grid>
                                        <Grid item xs={12} sm={6}>
                                            <TextField
                                                fullWidth
                                                size="small"
                                                variant="outlined"
                                                label="Max propositions per text block"
                                                type="number"
                                                value={settings.propApsMaxPropositions ?? 12}
                                                onChange={this.handleChange("propApsMaxPropositions")}
                                            />
                                        </Grid>
                                        <Grid item xs={12}>
                                            <FormControlLabel
                                                control={
                                                    <Checkbox
                                                        checked={!!settings.propApsAlignAttempts}
                                                        onChange={this.handleCheckboxChange(
                                                            "propApsAlignAttempts"
                                                        )}
                                                        onClick={(e) => e.stopPropagation()}
                                                        color="primary"
                                                    />
                                                }
                                                label="Align LLM attempts to propositions (selective BKT update)"
                                                onClick={(e) => e.stopPropagation()}
                                            />
                                            <Typography variant="caption" color="textSecondary" display="block">
                                                When on, attempt evidence updates matched props only (not all
                                                active hints). Uses heuristic overlap — no fine-tuning.
                                            </Typography>
                                        </Grid>
                                    </>
                                ) : null}
                            </>
                        )}
                    </Grid>

                    <Box mt={2} display="flex" style={{ gap: 8, flexWrap: "wrap", alignItems: "center" }}>
                        <Button variant="contained" color="primary" size="small" onClick={this.handleSave}>
                            Save settings
                        </Button>
                        <Button variant="outlined" size="small" onClick={this.handleReset}>
                            Reset defaults
                        </Button>
                        {settings.provider === LLM_PROVIDER.LOCAL_GPT_OSS && (
                            <Button
                                variant="outlined"
                                size="small"
                                onClick={this.handleProbe}
                                disabled={probing}
                            >
                                {probing ? "Testing..." : "Test LLM connection"}
                            </Button>
                        )}
                        {settings.skillBktBackend === SKILL_BKT_BACKEND.PYBKT && (
                            <Button
                                variant="outlined"
                                size="small"
                                onClick={this.handlePyBktProbe}
                                disabled={pyBktProbing}
                            >
                                {pyBktProbing ? "Testing..." : "Test pyBKT service"}
                            </Button>
                        )}
                        {probeStatus && (
                            <Chip
                                size="small"
                                label={probeStatus.text}
                                style={{
                                    backgroundColor: probeStatus.ok ? "#e8f5e9" : "#ffebee",
                                }}
                            />
                        )}
                        {pyBktProbeStatus && (
                            <Chip
                                size="small"
                                label={pyBktProbeStatus.text}
                                style={{
                                    backgroundColor: pyBktProbeStatus.ok ? "#e8f5e9" : "#ffebee",
                                }}
                            />
                        )}
                        {savedMessage && (
                            <Typography variant="caption" color="textSecondary">
                                {savedMessage}
                            </Typography>
                        )}
                    </Box>
                </Collapse>
            </Paper>
        );
    }
}

export default LLMSettingsPanel;
