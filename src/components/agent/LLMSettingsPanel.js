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
} from "@material-ui/core";
import SettingsIcon from "@material-ui/icons/Settings";
import ExpandMoreIcon from "@material-ui/icons/ExpandMore";
import ExpandLessIcon from "@material-ui/icons/ExpandLess";
import {
    DEFAULT_LLM_SETTINGS,
    LLM_PROVIDER,
    SKILL_HINT_MODES,
    PROP_HINT_MODES,
    SKILL_BKT_BACKEND,
    loadLLMSettings,
    saveLLMSettings,
} from "../../agent/llm/llmSettings.js";
import { probePyBktServer } from "../../agent/llm/pyBKTClient.js";
import {
    SKILL_HINT_MODE_META,
    PROP_HINT_MODE_META,
} from "../../agent/llm/beliefRetrieval.js";
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
        this.setState((prev) => ({
            settings: { ...prev.settings, [field]: value },
            savedMessage: null,
        }));
    };

    handleSave = async () => {
        const { browserStorage, onSettingsChange } = this.props;
        const { settings } = this.state;
        const merged = await saveLLMSettings(browserStorage, settings);
        try {
            localStorage.setItem("oatutor-llm-settings", JSON.stringify(merged));
        } catch {
            /* ignore */
        }
        resetOpenAIClient();
        this.setState({ settings: merged, savedMessage: "Settings saved." });
        onSettingsChange?.(merged);
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
        this.setState({
            probing: false,
            probeStatus: result.ok
                ? { ok: true, text: `Connected (${result.models?.length || 0} model(s) listed)` }
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
                        Configure the local gpt-oss-20b server (llama.cpp OpenAI API at{" "}
                        <code>http://127.0.0.1:8080/v1</code>) or fall back to the cloud GPT-4 hint
                        endpoint. Start the server with{" "}
                        <code>./scripts/serve-gpt-oss-20b-gpu.sh</code> from the Projects folder.
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
