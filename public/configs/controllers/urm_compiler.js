/* =========================================================================
   URM STUDIO — MOTOR DE EXECUÇÃO DE UNLIMITED REGISTER MACHINE
   Instruções suportadas:
     Z(n)       -> R(n) := 0
     S(n)       -> R(n) := R(n) + 1
     T(m, n)    -> R(n) := R(m)
     J(m, n, q) -> se R(m) == R(n) então salta para instrução q (1-indexed)
   Linhas começadas por ';' ou vazias são ignoradas (comentários).
   ========================================================================= */

(function () {
    "use strict";

    // ---------------------------------------------------------------------
    // DOM REFS
    // ---------------------------------------------------------------------
    const textarea = document.getElementById('code-input');
    const highlight = document.getElementById('code-highlight');
    const lineNumbers = document.getElementById('line-numbers');
    const parseStatus = document.getElementById('parse-status');
    const registerGrid = document.getElementById('register-grid');
    const executionLog = document.getElementById('execution-log');
    const statSteps = document.getElementById('stat-steps');
    const statStepsDelta = document.getElementById('stat-steps-delta');
    const memBar = document.getElementById('mem-bar');
    const memPct = document.getElementById('mem-pct');
    const statusDot = document.getElementById('status-dot');
    const statusText = document.getElementById('status-text');
    const exampleSelect = document.getElementById('example-select');
    const searchInput = document.getElementById('search-input');

    const btnPlay = document.getElementById('btn-play');
    const playIcon = document.getElementById('play-icon');
    const btnPause = document.getElementById('btn-pause');
    const btnStop = document.getElementById('btn-stop');
    const btnStepFwd = document.getElementById('btn-step-fwd');
    const btnStepBack = document.getElementById('btn-step-back');
    const btnRestart = document.getElementById('btn-restart');
    const btnSkipEnd = document.getElementById('btn-skip-end');
    const speedSlider = document.getElementById('speed-slider');
    const speedLabel = document.getElementById('speed-label');
    const btnNewSim = document.getElementById('btn-new-sim');

    const registersModal = document.getElementById('registers-modal');
    const btnEditRegisters = document.getElementById('btn-edit-registers');
    const btnCloseModal = document.getElementById('btn-close-modal');
    const btnCancelRegisters = document.getElementById('btn-cancel-registers');
    const btnApplyRegisters = document.getElementById('btn-apply-registers');
    const initialRegistersInput = document.getElementById('initial-registers-input');
    const btnClearLog = document.getElementById('btn-clear-log');

    // ---------------------------------------------------------------------
    // EXAMPLES
    // ---------------------------------------------------------------------
    const EXAMPLES = {
        multiply: {
            initial: { 1: 12, 2: 5 },
            code:
`; multiply.urm — R0 := R1 * R2 (preserva R1 e R2)
; R3 = contador externo (copia de R2) ; R4 = contador interno (copia de R1)
; R5,R6 e R7,R8 = pares auxiliares do predecessor ; R9 = constante zero (nunca escrito)
Z(0)
T(2, 3)
J(3, 9, 23)
T(1, 4)
J(4, 9, 15)
S(0)
Z(5)
Z(6)
J(4, 6, 13)
T(6, 5)
S(6)
J(9, 9, 9)
T(5, 4)
J(9, 9, 5)
Z(7)
Z(8)
J(3, 8, 21)
T(8, 7)
S(8)
J(9, 9, 17)
T(7, 3)
J(9, 9, 3)
T(0, 0)`
        },
        add: {
            initial: { 1: 7, 2: 4 },
            code:
`; add.urm — R0 := R1 + R2 (preserva R1 e R2)
; R3 = contador (copia de R2) ; R4,R5 = par auxiliar do predecessor
; R6 = constante zero (nunca escrito)
T(1, 0)
T(2, 3)
J(3, 6, 13)
S(0)
Z(4)
Z(5)
J(3, 5, 11)
T(5, 4)
S(5)
J(6, 6, 7)
T(4, 3)
J(6, 6, 3)
T(0, 0)`
        },
        subtract: {
            initial: { 1: 9, 2: 4 },
            code:
`; subtract.urm — R0 := max(R1 - R2, 0)  [subtracao monus, preserva R1 e R2]
; R3 = contador (copia de R2) ; R4,R5 e R6,R7 = pares auxiliares do predecessor
; R9 = constante zero (nunca escrito)
T(1, 0)
T(2, 3)
J(3, 9, 19)
Z(4)
Z(5)
J(0, 5, 10)
T(5, 4)
S(5)
J(9, 9, 6)
T(4, 0)
Z(6)
Z(7)
J(3, 7, 17)
T(7, 6)
S(7)
J(9, 9, 13)
T(6, 3)
J(9, 9, 3)
T(0, 0)`
        },
        copy: {
            initial: { 1: 21 },
            code:
`; copy.urm — copia R1 para R0 sem alterar R1
T(1, 0)`
        }
    };

    // ---------------------------------------------------------------------
    // STATE
    // ---------------------------------------------------------------------
    let program = [];           // parsed instructions [{type, args, raw, line}]
    let parseError = null;      // {line, message}
    let registers = {};         // { regNumber: value }
    let initialRegisters = { ...EXAMPLES.multiply.initial };
    let pc = 0;                 // program counter, 0-indexed into `program`
    let steps = 0;
    let halted = false;
    let runError = null;        // runtime error message
    let isRunning = false;      // auto-play active
    let runTimer = null;
    let history = [];           // snapshots for step-back: {registers, pc, steps}
    let knownRegisterNumbers = []; // sorted list of registers to display

    const SPEED_MIN_MS = 60;    // fastest (slider max)
    const SPEED_MAX_MS = 900;   // slowest (slider min)

    // ---------------------------------------------------------------------
    // PARSER
    // ---------------------------------------------------------------------
    function parseProgram(code) {
        const lines = code.split('\n');
        const instructions = [];
        let error = null;

        lines.forEach((rawLine, idx) => {
            const lineNo = idx + 1;
            const trimmed = rawLine.trim();

            if (trimmed === '' || trimmed.startsWith(';')) {
                return; // comment or blank — not an instruction
            }

            // Z(n)
            let m = trimmed.match(/^Z\s*\(\s*(\d+)\s*\)$/i);
            if (m) {
                instructions.push({ type: 'Z', args: [parseInt(m[1], 10)], line: lineNo, raw: rawLine });
                return;
            }

            // S(n)
            m = trimmed.match(/^S\s*\(\s*(\d+)\s*\)$/i);
            if (m) {
                instructions.push({ type: 'S', args: [parseInt(m[1], 10)], line: lineNo, raw: rawLine });
                return;
            }

            // T(m, n)
            m = trimmed.match(/^T\s*\(\s*(\d+)\s*,\s*(\d+)\s*\)$/i);
            if (m) {
                instructions.push({ type: 'T', args: [parseInt(m[1], 10), parseInt(m[2], 10)], line: lineNo, raw: rawLine });
                return;
            }

            // J(m, n, q)
            m = trimmed.match(/^J\s*\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*\)$/i);
            if (m) {
                instructions.push({ type: 'J', args: [parseInt(m[1], 10), parseInt(m[2], 10), parseInt(m[3], 10)], line: lineNo, raw: rawLine });
                return;
            }

            if (!error) {
                error = { line: lineNo, message: `Instrução inválida na linha ${lineNo}: "${trimmed}"` };
            }
        });

        return { instructions, error };
    }

    function collectRegisterNumbers(instructions, initial) {
        const set = new Set();
        Object.keys(initial).forEach(k => set.add(parseInt(k, 10)));
        instructions.forEach(instr => {
            if (instr.type === 'Z' || instr.type === 'S') {
                set.add(instr.args[0]);
            } else if (instr.type === 'T') {
                set.add(instr.args[0]);
                set.add(instr.args[1]);
            } else if (instr.type === 'J') {
                set.add(instr.args[0]);
                set.add(instr.args[1]);
            }
        });
        set.add(0); // R0 conventionally holds output
        const arr = Array.from(set).sort((a, b) => a - b);
        return arr.length ? arr : [0];
    }

    // ---------------------------------------------------------------------
    // SYNTAX HIGHLIGHT + LINE NUMBERS (preserves original behaviour, extends it)
    // ---------------------------------------------------------------------
    function escapeHtml(s) {
        return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
    }

    function renderEditor() {
        const code = textarea.value;
        highlight.scrollTop = textarea.scrollTop;
        highlight.scrollLeft = textarea.scrollLeft;

        const lines = code.split('\n');
        const count = lines.length;

        // Line numbers, highlighting active execution line
        let lineHtml = '';
        for (let i = 1; i <= count; i++) {
            const isActive = (!halted && !runError && program.length > 0 && program[pc] && program[pc].line === i);
            const isErrorLine = (parseError && parseError.line === i) || (runError && runError.line === i);
            const cls = isErrorLine ? 'line-num-active' : (isActive ? 'line-num-active' : '');
            lineHtml += `<span class="${cls}">${i}</span>`;
        }
        lineNumbers.innerHTML = lineHtml;
        lineNumbers.scrollTop = textarea.scrollTop;

        // Syntax highlighting per line, with active-line / error-line wrappers
        const highlightedCode = lines.map((line, i) => {
            const lineNo = i + 1;
            const trimmed = line.trim();
            let wrapperClass = '';

            if (trimmed.startsWith('Z')) wrapperClass = 'instr-z';
            else if (trimmed.startsWith('S')) wrapperClass = 'instr-s';
            else if (trimmed.startsWith('T')) wrapperClass = 'instr-t';
            else if (trimmed.startsWith('J')) wrapperClass = 'instr-j';

            const isActive = (!halted && !runError && program.length > 0 && program[pc] && program[pc].line === lineNo);
            const isErrorLine = (parseError && parseError.line === lineNo) || (runError && runError.line === lineNo);
            if (isErrorLine) wrapperClass += ' line-error';
            else if (isActive) wrapperClass += ' line-active';

            let escaped = escapeHtml(line);
            const processedLine = escaped.replace(/([ZSTJ])(\s*\([^)]*\))/gi, (match, instr, args) => {
                return `<span class="syntax-instr">${instr}</span><span class="syntax-args">${args}</span>`;
            });

            return `<div class="${wrapperClass}">${processedLine || ' '}</div>`;
        }).join('');

        highlight.innerHTML = highlightedCode;
    }

    // ---------------------------------------------------------------------
    // EXECUTION LOG
    // ---------------------------------------------------------------------
    function timeNow() {
        const d = new Date();
        return d.toTimeString().slice(0, 8);
    }

    function log(message, tone) {
        const colorClass = tone === 'error' ? 'text-error-container' :
                            tone === 'success' ? 'text-secondary-container' :
                            tone === 'accent' ? 'text-secondary-fixed font-bold' :
                            'text-inverse-on-surface';
        const entry = document.createElement('div');
        entry.className = 'flex gap-4 log-entry';
        entry.innerHTML = `<span class="text-secondary-fixed shrink-0">${timeNow()}</span><span class="${colorClass}">${escapeHtml(message)}</span>`;
        executionLog.appendChild(entry);
        executionLog.scrollTop = executionLog.scrollHeight;
    }

    function clearLog() {
        executionLog.innerHTML = '';
    }

    // ---------------------------------------------------------------------
    // REGISTER GRID RENDERING
    // ---------------------------------------------------------------------
    function buildRegisterGrid() {
        registerGrid.innerHTML = '';
        knownRegisterNumbers.forEach(n => {
            const card = document.createElement('div');
            card.className = 'reg-card bg-white border border-outline-variant rounded-lg p-3 flex flex-col items-center hover:shadow-md';
            card.id = `reg-card-${n}`;
            card.innerHTML = `
                <span class="font-label-sm text-label-sm text-on-surface-variant mb-1">R${n}</span>
                <span class="font-register-value text-register-value" id="reg-value-${n}">${formatVal(registers[n] || 0)}</span>
            `;
            registerGrid.appendChild(card);
        });
        highlightActiveRegisters();
    }

    function formatVal(v) {
        return v.toString().padStart(2, '0');
    }

    function updateRegisterDisplay(changedRegs) {
        knownRegisterNumbers.forEach(n => {
            const valueEl = document.getElementById(`reg-value-${n}`);
            if (valueEl) valueEl.textContent = formatVal(registers[n] || 0);
        });
        if (changedRegs && changedRegs.length) {
            changedRegs.forEach(n => {
                const card = document.getElementById(`reg-card-${n}`);
                if (card) {
                    card.classList.remove('flash');
                    const raf = window.requestAnimationFrame || function (cb) { setTimeout(cb, 0); };
                    raf(() => card.classList.add('flash'));
                }
            });
        }
        highlightActiveRegisters();
    }

    function highlightActiveRegisters() {
        // Highlight the register(s) the current instruction touches
        knownRegisterNumbers.forEach(n => {
            const card = document.getElementById(`reg-card-${n}`);
            if (!card) return;
            card.classList.remove('border-2', 'border-secondary-container', 'shadow-lg', 'scale-105', 'text-secondary');
            card.classList.add('border', 'border-outline-variant');
            const valueEl = document.getElementById(`reg-value-${n}`);
            if (valueEl) valueEl.classList.remove('text-secondary');
        });

        if (halted || runError || !program.length || !program[pc]) return;
        const instr = program[pc];
        let touched = [];
        if (instr.type === 'Z' || instr.type === 'S') touched = [instr.args[0]];
        else if (instr.type === 'T') touched = [instr.args[0], instr.args[1]];
        else if (instr.type === 'J') touched = [instr.args[0], instr.args[1]];

        touched.forEach(n => {
            const card = document.getElementById(`reg-card-${n}`);
            if (!card) return;
            card.classList.remove('border', 'border-outline-variant');
            card.classList.add('border-2', 'border-secondary-container', 'shadow-lg', 'scale-105');
            const valueEl = document.getElementById(`reg-value-${n}`);
            if (valueEl) valueEl.classList.add('text-secondary');
        });
    }

    // ---------------------------------------------------------------------
    // STATS
    // ---------------------------------------------------------------------
    function updateStats(prevSteps) {
        statSteps.textContent = steps.toLocaleString('pt-PT');
        const delta = steps - (prevSteps || 0);
        statStepsDelta.textContent = delta > 0 ? `+${delta}` : '\u00A0';

        const total = program.length || 1;
        const pct = halted ? 100 : Math.min(100, Math.round(((pc) / total) * 100));
        memBar.style.width = `${pct}%`;
        memPct.textContent = `${pct}%`;
    }

    // ---------------------------------------------------------------------
    // STATUS BADGE
    // ---------------------------------------------------------------------
    function setStatus(kind) {
        statusDot.classList.remove('halt-pulse');
        if (kind === 'running') {
            statusDot.className = 'w-2 h-2 rounded-full bg-secondary';
            statusText.textContent = 'A executar';
            statusText.className = 'text-secondary font-semibold';
        } else if (kind === 'paused') {
            statusDot.className = 'w-2 h-2 rounded-full bg-amber-500';
            statusText.textContent = 'Em pausa';
            statusText.className = 'text-on-surface-variant';
        } else if (kind === 'halted') {
            statusDot.className = 'w-2 h-2 rounded-full bg-secondary halt-pulse';
            statusText.textContent = 'Concluído';
            statusText.className = 'text-secondary font-semibold';
        } else if (kind === 'error') {
            statusDot.className = 'w-2 h-2 rounded-full bg-error';
            statusText.textContent = 'Erro de execução';
            statusText.className = 'text-error font-semibold';
        } else {
            statusDot.className = 'w-2 h-2 rounded-full bg-outline-variant';
            statusText.textContent = 'Idle';
            statusText.className = 'text-on-surface-variant';
        }
    }

    // ---------------------------------------------------------------------
    // CONTROL BUTTON ENABLE/DISABLE
    // ---------------------------------------------------------------------
    function refreshControls() {
        const programReady = program.length > 0 && !parseError;
        const atEnd = halted || !!runError;

        setCtrlEnabled(btnPlay, programReady && !atEnd);
        setCtrlEnabled(btnPause, isRunning);
        setCtrlEnabled(btnStop, isRunning || steps > 0);
        setCtrlEnabled(btnStepFwd, programReady && !atEnd && !isRunning);
        setCtrlEnabled(btnStepBack, history.length > 0 && !isRunning);
        setCtrlEnabled(btnRestart, (steps > 0 || halted || runError) && !isRunning);
        setCtrlEnabled(btnSkipEnd, programReady && !atEnd && !isRunning);

        playIcon.textContent = isRunning ? 'pause' : 'play_arrow';
        btnPlay.title = isRunning ? 'A executar…' : 'Executar';
    }

    function setCtrlEnabled(el, enabled) {
        if (enabled) el.classList.remove('ctrl-disabled');
        else el.classList.add('ctrl-disabled');
    }

    // ---------------------------------------------------------------------
    // CORE EXECUTION
    // ---------------------------------------------------------------------
    function resetExecutionState(keepLog) {
        stopAutoplay();
        const parsed = parseProgram(textarea.value);
        program = parsed.instructions;
        parseError = parsed.error;
        runError = null;
        steps = 0;
        pc = 0;
        halted = false;
        history = [];

        knownRegisterNumbers = collectRegisterNumbers(program, initialRegisters);
        registers = {};
        knownRegisterNumbers.forEach(n => { registers[n] = initialRegisters[n] || 0; });

        if (parseError) {
            parseStatus.innerHTML = `<span class="material-symbols-outlined text-[16px] text-error">error</span><span class="text-error">${escapeHtml(parseError.message)}</span>`;
            parseStatus.classList.remove('text-secondary');
            parseStatus.classList.add('text-error');
        } else {
            parseStatus.innerHTML = `<span class="material-symbols-outlined text-[16px]" style="font-variation-settings: 'FILL' 1;">check_circle</span><span>Programa válido — ${program.length} instruç${program.length === 1 ? 'ão' : 'ões'}</span>`;
            parseStatus.classList.remove('text-error');
            parseStatus.classList.add('text-secondary');
        }

        buildRegisterGrid();
        updateStats(0);
        setStatus('idle');
        if (!keepLog) {
            clearLog();
            log('Pronto. Carregue em ▶ para iniciar a simulação.', 'accent');
        }
        renderEditor();
        refreshControls();
    }

    // Executes exactly one instruction. Returns true if it executed, false if halted/error.
    // When `silent` is true, skips DOM-heavy work (logging, history snapshot, rendering) —
    // used for fast-forward (skip-to-end) so thousands of steps don't flood the log or heap.
    function stepOnce(silent) {
        if (parseError) {
            if (!silent) { log(parseError.message, 'error'); setStatus('error'); }
            return false;
        }
        if (halted || runError) return false;

        if (pc >= program.length) {
            halted = true;
            if (!silent) {
                log(`Máquina parada — fim do programa atingido (PC=${pc + 1}).`, 'success');
                log(`Resultado final: R0 = ${registers[0] || 0}`, 'success');
                setStatus('halted');
                renderEditor();
                highlightActiveRegisters();
                refreshControls();
            }
            return false;
        }

        // snapshot for step-back (skipped in silent mode — fast-forward is not steppable-back)
        if (!silent) {
            history.push({
                registers: { ...registers },
                pc,
                steps
            });
        }

        const instr = program[pc];
        const prevSteps = steps;
        let changedRegs = [];
        let description = '';

        try {
            switch (instr.type) {
                case 'Z': {
                    const [n] = instr.args;
                    registers[n] = 0;
                    changedRegs = [n];
                    description = `Z(${n}) → R${n} := 0`;
                    pc += 1;
                    break;
                }
                case 'S': {
                    const [n] = instr.args;
                    registers[n] = (registers[n] || 0) + 1;
                    changedRegs = [n];
                    description = `S(${n}) → R${n} := R${n} + 1 = ${registers[n]}`;
                    pc += 1;
                    break;
                }
                case 'T': {
                    const [m, n] = instr.args;
                    registers[n] = registers[m] || 0;
                    changedRegs = [n];
                    description = `T(${m}, ${n}) → R${n} := R${m} = ${registers[n]}`;
                    pc += 1;
                    break;
                }
                case 'J': {
                    const [m, n, q] = instr.args;
                    const rm = registers[m] || 0;
                    const rn = registers[n] || 0;
                    changedRegs = [m, n];
                    if (rm === rn) {
                        if (q < 1 || q > program.length + 1) {
                            throw { message: `Salto inválido: J(${m}, ${n}, ${q}) na linha ${instr.line} aponta para uma instrução inexistente (${q}).`, line: instr.line };
                        }
                        description = `J(${m}, ${n}, ${q}) → R${m}=${rm} = R${n}=${rn}, salta para instrução ${q}`;
                        pc = q - 1;
                    } else {
                        description = `J(${m}, ${n}, ${q}) → R${m}=${rm} ≠ R${n}=${rn}, continua`;
                        pc += 1;
                    }
                    break;
                }
            }
        } catch (e) {
            runError = { message: e.message, line: e.line };
            if (!silent) {
                log(e.message, 'error');
                setStatus('error');
                renderEditor();
                refreshControls();
            }
            return false;
        }

        steps += 1;

        if (!silent) {
            log(`#${steps} · linha ${instr.line} · ${description}`);
            updateRegisterDisplay(changedRegs);
            updateStats(prevSteps);
            renderEditor();
            refreshControls();
        }

        if (pc >= program.length) {
            // will halt cleanly on next call; report immediately for snappy UX
            halted = true;
            if (!silent) {
                log(`Máquina parada — fim do programa atingido.`, 'success');
                log(`Resultado final: R0 = ${registers[0] || 0}`, 'success');
                setStatus('halted');
                renderEditor();
                refreshControls();
            }
            return false;
        }

        return true;
    }

    function stepBack() {
        if (!history.length || isRunning) return;
        const snap = history.pop();
        registers = { ...snap.registers };
        pc = snap.pc;
        steps = snap.steps;
        halted = false;
        runError = null;
        log(`↶ Recuou para o estado antes do passo #${steps + 1}.`, 'accent');
        updateRegisterDisplay();
        updateStats(steps);
        setStatus(steps > 0 ? 'paused' : 'idle');
        renderEditor();
        refreshControls();
    }

    function currentSpeedMs() {
        const sliderVal = parseInt(speedSlider.value, 10); // 1..20
        const t = (sliderVal - 1) / 19; // 0..1
        return Math.round(SPEED_MAX_MS - t * (SPEED_MAX_MS - SPEED_MIN_MS));
    }

    function updateSpeedLabel() {
        const sliderVal = parseInt(speedSlider.value, 10);
        const multiplier = (sliderVal / 8).toFixed(1); // 8 == "1.0x" baseline, matches original default
        speedLabel.textContent = `${multiplier}x`;
    }

    function startAutoplay() {
        if (isRunning) return;
        if (parseError || halted || runError) return;
        isRunning = true;
        setStatus('running');
        refreshControls();
        tick();
    }

    function tick() {
        if (!isRunning) return;
        const cont = stepOnce();
        if (!cont) {
            isRunning = false;
            refreshControls();
            return;
        }
        runTimer = setTimeout(tick, currentSpeedMs());
    }

    function stopAutoplay() {
        isRunning = false;
        if (runTimer) {
            clearTimeout(runTimer);
            runTimer = null;
        }
    }

    function pauseExecution() {
        if (!isRunning) return;
        stopAutoplay();
        setStatus(steps > 0 ? 'paused' : 'idle');
        log('⏸ Execução pausada.', 'accent');
        refreshControls();
    }

    function stopExecution() {
        const wasActive = isRunning || steps > 0;
        stopAutoplay();
        resetExecutionState(true);
        if (wasActive) log('■ Execução interrompida e estado reiniciado.', 'accent');
        refreshControls();
    }

    function skipToEnd() {
        if (parseError) return;
        stopAutoplay();
        const stepsBefore = steps;
        let guard = 0;
        const MAX_STEPS = 500000; // safety guard against infinite loops (silent mode, so this is cheap)
        while (!halted && !runError && guard < MAX_STEPS) {
            const cont = stepOnce(true);
            guard += 1;
            if (!cont) break;
        }

        if (guard >= MAX_STEPS && !halted && !runError) {
            runError = { message: `Limite de segurança atingido (${MAX_STEPS.toLocaleString('pt-PT')} passos) — possível ciclo infinito. A máquina foi interrompida.`, line: null };
        }

        // Single DOM update at the end, regardless of how many steps ran silently.
        log(`⏭ Avanço rápido: ${(steps - stepsBefore).toLocaleString('pt-PT')} passo(s) executado(s) silenciosamente.`, 'accent');
        if (runError) {
            log(runError.message, 'error');
            setStatus('error');
        } else if (halted) {
            log(`Máquina parada — fim do programa atingido.`, 'success');
            log(`Resultado final: R0 = ${registers[0] || 0}`, 'success');
            setStatus('halted');
        }
        updateRegisterDisplay();
        updateStats(stepsBefore);
        renderEditor();
        refreshControls();
    }

    // ---------------------------------------------------------------------
    // INITIAL REGISTERS MODAL
    // ---------------------------------------------------------------------
    function openRegistersModal() {
        const pairs = Object.entries(initialRegisters)
            .filter(([, v]) => v !== 0)
            .map(([k, v]) => `${k}=${v}`)
            .join(', ');
        initialRegistersInput.value = pairs;
        registersModal.classList.remove('hidden');
        registersModal.classList.add('flex');
        initialRegistersInput.focus();
    }

    function closeRegistersModal() {
        registersModal.classList.add('hidden');
        registersModal.classList.remove('flex');
    }

    function applyRegistersModal() {
        const raw = initialRegistersInput.value.trim();
        const newInitial = {};
        if (raw.length) {
            const parts = raw.split(',');
            for (const part of parts) {
                const m = part.trim().match(/^(\d+)\s*=\s*(\d+)$/);
                if (!m) {
                    log(`Formato inválido em "${part.trim()}" — use registo=valor, ex: 1=12`, 'error');
                    return;
                }
                newInitial[parseInt(m[1], 10)] = parseInt(m[2], 10);
            }
        }
        initialRegisters = newInitial;
        closeRegistersModal();
        resetExecutionState(false);
        log('Registos iniciais atualizados.', 'accent');
    }

    // ---------------------------------------------------------------------
    // EVENT WIRING
    // ---------------------------------------------------------------------
    textarea.addEventListener('input', () => {
        stopAutoplay();
        resetExecutionState(false);
    });
    textarea.addEventListener('scroll', renderEditor);

    textarea.addEventListener('keydown', (e) => {
        if (e.key === 'Tab') {
            e.preventDefault();
            const start = textarea.selectionStart;
            const end = textarea.selectionEnd;
            textarea.value = textarea.value.substring(0, start) + "\t" + textarea.value.substring(end);
            textarea.selectionStart = textarea.selectionEnd = start + 1;
            stopAutoplay();
            resetExecutionState(false);
        }
    });

    btnPlay.addEventListener('click', () => {
        if (isRunning) {
            pauseExecution();
        } else {
            if (halted || runError) return;
            log(steps === 0 ? '▶ Iniciando execução…' : '▶ Retomando execução…', 'accent');
            startAutoplay();
        }
    });
    btnPause.addEventListener('click', pauseExecution);
    btnStop.addEventListener('click', stopExecution);
    btnStepFwd.addEventListener('click', () => {
        if (isRunning) return;
        stepOnce();
    });
    btnStepBack.addEventListener('click', stepBack);
    btnRestart.addEventListener('click', () => {
        resetExecutionState(true);
        log('↺ Estado reiniciado para o início do programa.', 'accent');
    });
    btnSkipEnd.addEventListener('click', skipToEnd);

    speedSlider.addEventListener('input', updateSpeedLabel);

    btnEditRegisters.addEventListener('click', openRegistersModal);
    btnCloseModal.addEventListener('click', closeRegistersModal);
    btnCancelRegisters.addEventListener('click', closeRegistersModal);
    btnApplyRegisters.addEventListener('click', applyRegistersModal);
    registersModal.addEventListener('click', (e) => {
        if (e.target === registersModal) closeRegistersModal();
    });
    initialRegistersInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') applyRegistersModal();
    });

    btnClearLog.addEventListener('click', () => {
        clearLog();
        log('Registo de execução limpo.', 'accent');
    });

    exampleSelect.addEventListener('change', () => {
        const key = exampleSelect.value;
        const ex = EXAMPLES[key];
        if (!ex) return;
        textarea.value = ex.code;
        initialRegisters = { ...ex.initial };
        resetExecutionState(false);
        log(`Exemplo carregado: ${key}.urm`, 'accent');
    });

    btnNewSim.addEventListener('click', () => {
        exampleSelect.value = 'multiply';
        textarea.value = EXAMPLES.multiply.code;
        initialRegisters = { ...EXAMPLES.multiply.initial };
        resetExecutionState(false);
        log('Nova simulação criada a partir do modelo multiply.urm.', 'accent');
    });

    // Keyboard shortcuts: space = play/pause, right arrow = step, left = step back
    document.addEventListener('keydown', (e) => {
        if (document.activeElement === textarea || document.activeElement === initialRegistersInput || document.activeElement === searchInput) return;
        if (e.code === 'Space') {
            e.preventDefault();
            btnPlay.click();
        } else if (e.code === 'ArrowRight') {
            e.preventDefault();
            if (!isRunning) stepOnce();
        } else if (e.code === 'ArrowLeft') {
            e.preventDefault();
            stepBack();
        }
    });

    // Search functions box: simple jump-to-line for instruction search (Z/S/T/J or line number)
    searchInput.addEventListener('keydown', (e) => {
        if (e.key !== 'Enter') return;
        const q = searchInput.value.trim();
        if (!q) return;
        const lineNum = parseInt(q, 10);
        let targetLine = null;
        if (!isNaN(lineNum)) {
            targetLine = lineNum;
        } else {
            const found = program.find(p => p.type.toLowerCase() === q.toLowerCase());
            if (found) targetLine = found.line;
        }
        if (targetLine) {
            const lines = textarea.value.split('\n');
            let charIndex = 0;
            for (let i = 0; i < targetLine - 1 && i < lines.length; i++) charIndex += lines[i].length + 1;
            textarea.focus();
            textarea.setSelectionRange(charIndex, charIndex + (lines[targetLine - 1] ? lines[targetLine - 1].length : 0));
        }
    });

    // ---------------------------------------------------------------------
    // INIT
    // ---------------------------------------------------------------------
    updateSpeedLabel();
    resetExecutionState(false);
})();