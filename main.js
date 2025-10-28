/* 该文件内容与根目录 main.js 相同（已复制）。若后续仅使用打飞机目录，可删除根目录旧文件。*/
// 为保持一致性，这里直接复制当前版本 main.js 内容：

/* 基础设置 */
const canvas = document.getElementById('game-canvas');
const ctx = canvas.getContext('2d');
const dpr = Math.max(1, Math.min(2, window.devicePixelRatio || 1));

function resizeCanvas() {
    const { clientWidth, clientHeight } = canvas;
    canvas.width = Math.floor(clientWidth * dpr);
    canvas.height = Math.floor(clientHeight * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
}

// 适配父容器尺寸
function fitCanvasToParent() {
    const root = document.getElementById('game-root');
    canvas.style.width = `${root.clientWidth}px`;
    canvas.style.height = `${root.clientHeight}px`;
    resizeCanvas();
}

window.addEventListener('resize', fitCanvasToParent);
fitCanvasToParent();

/* DOM */
const overlay = document.getElementById('overlay');
const startBtn = document.getElementById('start-btn');
const pauseBtn = document.getElementById('pause-btn');
const muteBtn = document.getElementById('mute-btn');
const gameover = document.getElementById('gameover');
const restartBtn = document.getElementById('restart-btn');
const scoreEl = document.getElementById('score');
const livesEl = document.getElementById('lives');
const finalScoreEl = document.getElementById('final-score');
const weaponLabel = document.getElementById('weapon');
const scoreTop = document.getElementById('score-top');

/* 游戏状态 */
const State = {
    Menu: 'menu',
    Playing: 'playing',
    Paused: 'paused',
    GameOver: 'gameover'
};

let gameState = State.Menu;
let lastTime = 0;
let accumulator = 0;
const fixedDt = 1000 / 60; // 60fps 固定时间步

/* 世界参数 */
const world = {
    width: () => canvas.clientWidth,
    height: () => canvas.clientHeight,
    bgStars: [],
};

/* 实体定义 */
function createPlayer() {
    const w = 36, h = 36;
    return {
        x: world.width() / 2 - w / 2,
        y: world.height() - h - 20,
        w, h,
        speed: 360,
        fireCooldownMs: 120,
        fireTimer: 0,
        lives: 3,
        invincibleTimer: 0,
    };
}

function createBullet(x, y, extra = {}) {
    return { x, y, w: 4, h: 10, speed: 600, alive: true, damage: 1, kind: 'normal', ...extra };
}

function createEnemy() {
    const size = 26 + Math.random() * 22;
    const x = Math.random() * (world.width() - size);
    const y = -size - Math.random() * 100;
    const wobblePhase = Math.random() * Math.PI * 2;
    // 敌人类型：颜色区分与数值差异
    const types = [
        { key: 'green', color: '#6aff8f', speed: 120, hpMul: 0.8 },  // 快速
        { key: 'red', color: '#ff6b6b', speed: 90, hpMul: 1.0 },  // 普通
        { key: 'purple', color: '#c17cff', speed: 70, hpMul: 1.6 },  // 重甲
        { key: 'yellow', color: '#ffd166', speed: 100, hpMul: 1.2 },  // 敏捷
        { key: 'cyan', color: '#7cf', speed: 85, hpMul: 1.3 }   // 均衡
    ];
    const t = types[Math.floor(Math.random() * types.length)];
    const baseHp = size > 40 ? 3 : 2;
    const hp = Math.max(1, Math.round(baseHp * t.hpMul));
    const speed = t.speed + Math.random() * 30 - 15;
    return { x, y, w: size, h: size, speed, hp, alive: true, wobblePhase, color: t.color };
}

function createPowerup(x, y) {
    const r = Math.random();
    let type;
    if (r < 0.15) type = WeaponType.Laser;
    else if (r < 0.45) type = WeaponType.Spread;
    else if (r < 0.7) type = WeaponType.Rocket;
    else type = WeaponType.Plasma;
    return { x, y, w: 18, h: 18, vy: 120, type, alive: true, t: 0 };
}

/* 游戏数据 */
let player;
let bullets = [];
let enemies = [];
let score = 0;
let enemySpawnTimer = 0;
let powerups = [];
let explosions = [];
let arcs = [];
let noiseBuffer = null;

const WeaponType = {
    Normal: '普通',
    Spread: '散弹',
    Laser: '激光',
    Rocket: '火箭',
    Plasma: '等离子'
};
let weapon = { type: WeaponType.Normal, timerMs: 0 };

/* 输入 */
const input = { left: false, right: false, shoot: false };

window.addEventListener('keydown', (e) => {
    if (e.code === 'ArrowLeft' || e.code === 'KeyA') input.left = true;
    if (e.code === 'ArrowRight' || e.code === 'KeyD') input.right = true;
    if (e.code === 'Space') input.shoot = true;
    if (e.code === 'KeyP') togglePause();
});
window.addEventListener('keyup', (e) => {
    if (e.code === 'ArrowLeft' || e.code === 'KeyA') input.left = false;
    if (e.code === 'ArrowRight' || e.code === 'KeyD') input.right = false;
    if (e.code === 'Space') input.shoot = false;
});

// 触控（拖动移动，自动连发）
let touchId = null;
canvas.addEventListener('touchstart', (e) => {
    e.preventDefault();
    if (gameState !== State.Playing) return;
    if (touchId === null && e.changedTouches.length) {
        touchId = e.changedTouches[0].identifier;
        input.shoot = true;
    }
}, { passive: false });
canvas.addEventListener('touchmove', (e) => {
    e.preventDefault();
    if (gameState !== State.Playing) return;
    for (const t of e.changedTouches) {
        if (t.identifier === touchId) {
            player.x = Math.max(0, Math.min(world.width() - player.w, t.clientX - canvas.getBoundingClientRect().left - player.w / 2));
        }
    }
}, { passive: false });
canvas.addEventListener('touchend', (e) => {
    e.preventDefault();
    for (const t of e.changedTouches) {
        if (t.identifier === touchId) {
            touchId = null;
            input.shoot = false;
        }
    }
}, { passive: false });

pauseBtn.addEventListener('click', () => togglePause());
startBtn.addEventListener('click', () => startGame());
restartBtn.addEventListener('click', () => startGame());

/* 音频系统 */
let audioCtx = null;
let masterGain = null;
let audioUnlocked = false;
let muted = false;

function initAudio() {
    if (audioUnlocked) return;
    const Ctx = window.AudioContext || window.webkitAudioContext;
    if (!Ctx) return; // 无 WebAudio 支持时静默
    audioCtx = new Ctx();
    masterGain = audioCtx.createGain();
    masterGain.gain.value = muted ? 0 : 0.35; // 柔和音量
    masterGain.connect(audioCtx.destination);
    audioUnlocked = true;
}

function setMuted(v) {
    muted = v;
    if (masterGain) masterGain.gain.value = muted ? 0 : 0.35;
    muteBtn.textContent = muted ? '🔇' : '🔊';
}

function playTone({ type = 'sine', freq = 440, duration = 0.12, attack = 0.005, release = 0.08, detune = 0, startFreq = null, endFreq = null, volume = 1 }) {
    if (!audioUnlocked || muted || !audioCtx) return;
    const now = audioCtx.currentTime;
    const osc = audioCtx.createOscillator();
    const gain = audioCtx.createGain();
    osc.type = type;
    if (startFreq && endFreq) {
        osc.frequency.setValueAtTime(startFreq, now);
        osc.frequency.linearRampToValueAtTime(endFreq, now + duration);
    } else {
        osc.frequency.setValueAtTime(freq, now);
    }
    if (detune) osc.detune.setValueAtTime(detune, now);
    gain.gain.setValueAtTime(0, now);
    gain.gain.linearRampToValueAtTime(volume, now + attack);
    gain.gain.linearRampToValueAtTime(0, now + duration + release);
    osc.connect(gain);
    gain.connect(masterGain);
    osc.start(now);
    osc.stop(now + duration + release + 0.01);
}

function sfxShoot(kind = 'normal') {
    // 更柔和，音量更低
    if (kind === 'laser') {
        playTone({ type: 'sine', startFreq: 1200, endFreq: 1000, duration: 0.06, attack: 0.002, release: 0.05, volume: 0.35 });
    } else if (kind === 'spread') {
        playTone({ type: 'triangle', startFreq: 900, endFreq: 700, duration: 0.07, attack: 0.003, release: 0.06, volume: 0.4 });
    } else if (kind === 'rocket') {
        playTone({ type: 'sawtooth', startFreq: 300, endFreq: 260, duration: 0.12, attack: 0.006, release: 0.1, volume: 0.32 });
    } else if (kind === 'plasma') {
        playTone({ type: 'sine', startFreq: 700, endFreq: 600, duration: 0.08, attack: 0.004, release: 0.07, volume: 0.38 });
    } else {
        playTone({ type: 'sine', startFreq: 850, endFreq: 720, duration: 0.06, attack: 0.003, release: 0.05, volume: 0.35 });
    }
}
function sfxHit() {
    playTone({ type: 'sine', startFreq: 600, endFreq: 420, duration: 0.09, attack: 0.004, release: 0.08 });
}
function sfxHurt() {
    playTone({ type: 'sawtooth', startFreq: 300, endFreq: 180, duration: 0.14, attack: 0.006, release: 0.12, detune: -10 });
}
function sfxGameOver() {
    // 两音下行，柔和收尾
    playTone({ type: 'sine', startFreq: 520, endFreq: 380, duration: 0.18, attack: 0.01, release: 0.12 });
    setTimeout(() => playTone({ type: 'sine', startFreq: 360, endFreq: 240, duration: 0.22, attack: 0.01, release: 0.16 }), 120);
}

function sfxPickup() {
    playTone({ type: 'triangle', startFreq: 700, endFreq: 1000, duration: 0.12, attack: 0.005, release: 0.08, volume: 0.6 });
}

function sfxBoom() {
    playTone({ type: 'sine', startFreq: 220, endFreq: 140, duration: 0.18, attack: 0.008, release: 0.18, volume: 0.45 });
}

function sfxZap() {
    if (!audioUnlocked) initAudio();
    if (!audioCtx || muted) return;
    // 准备噪声缓冲
    if (!noiseBuffer) {
        const dur = 0.08;
        const sampleRate = audioCtx.sampleRate;
        const len = Math.floor(sampleRate * dur);
        const buffer = audioCtx.createBuffer(1, len, sampleRate);
        const data = buffer.getChannelData(0);
        for (let i = 0; i < len; i++) {
            // 脉冲噪声提升“电弧”质感
            data[i] = (Math.random() * 2 - 1) * (i / len);
        }
        noiseBuffer = buffer;
    }
    const now = audioCtx.currentTime;
    const src = audioCtx.createBufferSource();
    src.buffer = noiseBuffer;
    const bp = audioCtx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.setValueAtTime(2200, now);
    bp.Q.setValueAtTime(6, now);
    const g = audioCtx.createGain();
    g.gain.setValueAtTime(0, now);
    g.gain.linearRampToValueAtTime(0.45, now + 0.01);
    g.gain.linearRampToValueAtTime(0, now + 0.1);

    // 叠加轻微高频滑音
    const osc = audioCtx.createOscillator();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(1400, now);
    osc.frequency.exponentialRampToValueAtTime(800, now + 0.11);
    const og = audioCtx.createGain();
    og.gain.setValueAtTime(0.15, now);
    og.gain.linearRampToValueAtTime(0, now + 0.12);

    src.connect(bp); bp.connect(g); g.connect(masterGain);
    osc.connect(og); og.connect(masterGain);
    src.start(now);
    src.stop(now + 0.12);
    osc.start(now);
    osc.stop(now + 0.13);
}

muteBtn.addEventListener('click', () => {
    initAudio();
    if (audioCtx && audioCtx.state === 'suspended') audioCtx.resume();
    setMuted(!muted);
});

function togglePause() {
    if (gameState === State.Playing) {
        gameState = State.Paused;
        pauseBtn.textContent = '继续';
    } else if (gameState === State.Paused) {
        gameState = State.Playing;
        lastTime = performance.now(); // 防止暂停后时间跳变
        pauseBtn.textContent = '暂停';
        requestAnimationFrame(loop);
    }
}

function startGame() {
    initAudio(); // 首次用户手势时解锁
    if (audioCtx && audioCtx.state === 'suspended') audioCtx.resume();
    overlay.classList.remove('show');
    gameover.classList.remove('show');
    score = 0;
    bullets = [];
    enemies = [];
    powerups = [];
    enemySpawnTimer = 0;
    player = createPlayer();
    scoreEl.textContent = score.toString();
    if (scoreTop) scoreTop.textContent = score.toString();
    livesEl.textContent = player.lives.toString();
    weapon = { type: WeaponType.Normal, timerMs: 0 };
    if (weaponLabel) weaponLabel.textContent = `｜武器：${weapon.type}`;
    gameState = State.Playing;
    pauseBtn.textContent = '暂停';
    lastTime = performance.now();
    requestAnimationFrame(loop);
}

/* 背景星空 */
function initStars() {
    const count = Math.floor((world.width() * world.height()) / 12000);
    world.bgStars = Array.from({ length: count }, () => ({
        x: Math.random() * world.width(),
        y: Math.random() * world.height(),
        r: Math.random() * 1.8 + 0.2,
        s: Math.random() * 30 + 20
    }));
}
initStars();

/* 工具函数 */
function aabb(a, b) {
    return a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
}

function aabbCenter(a, b) {
    const ax = a.x + a.w / 2, ay = a.y + a.h / 2;
    const bx = b.x + b.w / 2, by = b.y + b.h / 2;
    const dx = Math.abs(ax - bx), dy = Math.abs(ay - by);
    return dx < (a.w + b.w) / 2 && dy < (a.h + b.h) / 2;
}

/* 更新逻辑 */
function update(dtMs) {
    // 背景
    for (const star of world.bgStars) {
        star.y += (star.s * dtMs) / 1000;
        if (star.y > world.height()) {
            star.y = -2;
            star.x = Math.random() * world.width();
        }
    }

    // 玩家
    if (player.invincibleTimer > 0) player.invincibleTimer -= dtMs;
    const dir = (input.right ? 1 : 0) - (input.left ? 1 : 0);
    player.x += dir * player.speed * (dtMs / 1000);
    player.x = Math.max(0, Math.min(world.width() - player.w, player.x));

    // 武器计时
    if (weapon.timerMs > 0) {
        weapon.timerMs -= dtMs;
        if (weapon.timerMs <= 0) {
            weapon.type = WeaponType.Normal;
            weapon.timerMs = 0;
            if (weaponLabel) weaponLabel.textContent = `｜武器：${weapon.type}`;
        } else if (weaponLabel) {
            weaponLabel.textContent = `｜武器：${weapon.type}（${Math.ceil(weapon.timerMs / 1000)}s）`;
        }
    }

    // 射击
    player.fireTimer -= dtMs;
    if (input.shoot && player.fireTimer <= 0) {
        const cx = player.x + player.w / 2 - 2;
        if (weapon.type === WeaponType.Normal) {
            bullets.push(createBullet(cx, player.y - 8, { kind: 'normal' }));
            player.fireTimer = player.fireCooldownMs;
            sfxShoot('normal');
        } else if (weapon.type === WeaponType.Spread) {
            const base = createBullet(cx, player.y - 8, { kind: 'spread' });
            const left = createBullet(cx, player.y - 8, { kind: 'spread', vx: -220 });
            const right = createBullet(cx, player.y - 8, { kind: 'spread', vx: 220 });
            base.vx = 0;
            bullets.push(base, left, right);
            player.fireTimer = Math.max(70, player.fireCooldownMs + 40);
            sfxShoot('spread');
        } else if (weapon.type === WeaponType.Laser) {
            const b = createBullet(cx + 1, player.y - 10, { kind: 'laser' });
            b.w = 2; b.h = 22; b.speed = 1200; b.pierce = 3; b.damage = 1;
            bullets.push(b);
            player.fireTimer = 40;
            sfxShoot('laser');
        } else if (weapon.type === WeaponType.Rocket) {
            const b = createBullet(cx - 3, player.y - 12, { kind: 'rocket' });
            b.w = 10; b.h = 18; b.speed = 520; b.damage = 3.5; b.aoe = 40;
            bullets.push(b);
            player.fireTimer = Math.max(120, player.fireCooldownMs + 80);
            sfxShoot('rocket');
        } else if (weapon.type === WeaponType.Plasma) {
            const b1 = createBullet(cx - 3, player.y - 8, { kind: 'plasma' });
            const b2 = createBullet(cx + 3, player.y - 8, { kind: 'plasma' });
            b1.w = b2.w = 3; b1.h = b2.h = 14; b1.speed = b2.speed = 800; b1.damage = b2.damage = 1.5;
            bullets.push(b1, b2);
            player.fireTimer = Math.max(60, player.fireCooldownMs - 10);
            sfxShoot('plasma');
        }
    }

    // 子弹
    for (const b of bullets) {
        b.y -= b.speed * (dtMs / 1000);
        if (b.vx) b.x += b.vx * (dtMs / 1000);
        if (b.y + b.h < 0 || b.x < -20 || b.x > world.width() + 20) b.alive = false;
    }
    bullets = bullets.filter(b => b.alive);

    // 敌机生成
    enemySpawnTimer -= dtMs;
    const spawnInterval = Math.max(280, 900 - score * 2);
    if (enemySpawnTimer <= 0) {
        enemies.push(createEnemy());
        enemySpawnTimer = spawnInterval;
    }

    // 敌机更新
    for (const e of enemies) {
        e.y += e.speed * (dtMs / 1000);
        e.x += Math.sin((performance.now() / 1000) + e.wobblePhase) * 0.6;
        if (e.y > world.height() + 40) e.alive = false;
    }
    enemies = enemies.filter(e => e.alive);

    // 碰撞：子弹-敌机
    for (const e of enemies) {
        for (const b of bullets) {
            if (aabb(e, b)) {
                if (b.pierce && b.pierce > 0) {
                    b.pierce -= 1;
                } else {
                    b.alive = false;
                }
                const damage = b.damage ? b.damage : 1;
                e.hp -= damage;
                if (e.hp <= 0) {
                    e.alive = false;
                    score += 10;
                    scoreEl.textContent = score.toString();
                    if (scoreTop) scoreTop.textContent = score.toString();
                    sfxHit();
                    if (Math.random() < 0.25) {
                        powerups.push(createPowerup(e.x + e.w / 2 - 9, e.y + e.h / 2 - 9));
                    }
                } else {
                    sfxHit();
                }

                // 命中特效：火箭爆炸 AOE、等离子电弧链
                if (b.kind === 'rocket') {
                    const ex = { x: e.x + e.w / 2, y: e.y + e.h / 2, r: b.aoe || 40, life: 220, t: 0 };
                    explosions.push(ex);
                    sfxBoom();
                    for (const e2 of enemies) {
                        if (!e2.alive) continue;
                        const dx = e2.x + e2.w / 2 - ex.x;
                        const dy = e2.y + e2.h / 2 - ex.y;
                        const dist = Math.hypot(dx, dy);
                        if (dist <= ex.r + Math.max(e2.w, e2.h) / 2) {
                            e2.hp -= 2; // AOE 固定伤害
                            if (e2.hp <= 0) {
                                e2.alive = false;
                                score += 10;
                                scoreEl.textContent = score.toString();
                                if (scoreTop) scoreTop.textContent = score.toString();
                            }
                        }
                    }
                } else if (b.kind === 'plasma') {
                    // 选取最近的若干目标，绘制电弧并造成伤害
                    const source = { x: e.x + e.w / 2, y: e.y + e.h / 2 };
                    const targets = enemies
                        .filter(en => en.alive && en !== e)
                        .map(en => ({ en, d: Math.hypot(en.x + en.w / 2 - source.x, en.y + en.h / 2 - source.y) }))
                        .filter(x => x.d < 120)
                        .sort((a, b2) => a.d - b2.d)
                        .slice(0, 3);
                    for (const { en } of targets) {
                        arcs.push({ x1: source.x, y1: source.y, x2: en.x + en.w / 2, y2: en.y + en.h / 2, life: 120, t: 0 });
                        en.hp -= 1.5;
                        if (en.hp <= 0) {
                            en.alive = false;
                            score += 10;
                            scoreEl.textContent = score.toString();
                            if (scoreTop) scoreTop.textContent = score.toString();
                        }
                    }
                    if (targets.length) sfxZap();
                }
            }
        }
    }

    // 道具：下落与拾取
    for (const p of powerups) {
        p.t += dtMs;
        p.y += p.vy * (dtMs / 1000);
        p.x += Math.sin(p.t / 250) * 0.6;
        if (p.y > world.height() + 20) p.alive = false;
        if (aabbCenter(p, player)) {
            p.alive = false;
            weapon.type = p.type;
            weapon.timerMs = 10000;
            if (weaponLabel) weaponLabel.textContent = `｜武器：${weapon.type}（${Math.ceil(weapon.timerMs / 1000)}s）`;
            sfxPickup();
        }
    }
    powerups = powerups.filter(p => p.alive);

    // 爆炸与电弧生命周期推进
    for (const ex of explosions) {
        ex.t += dtMs;
        if (ex.t > ex.life) ex.dead = true;
    }
    explosions = explosions.filter(e => !e.dead);
    for (const a of arcs) {
        a.t += dtMs;
        if (a.t > a.life) a.dead = true;
    }
    arcs = arcs.filter(a => !a.dead);

    // 碰撞：玩家-敌机
    if (player.invincibleTimer <= 0) {
        for (const e of enemies) {
            if (aabb(e, player)) {
                e.alive = false;
                player.lives -= 1;
                livesEl.textContent = player.lives.toString();
                player.invincibleTimer = 1500;
                sfxHurt();
                if (player.lives <= 0) {
                    endGame();
                }
                break;
            }
        }
    }
}

function endGame() {
    gameState = State.GameOver;
    finalScoreEl.textContent = score.toString();
    gameover.classList.add('show');
    sfxGameOver();
}

/* 渲染 */
function render() {
    ctx.clearRect(0, 0, canvas.clientWidth, canvas.clientHeight);

    // 背景星空
    ctx.fillStyle = 'rgba(255,255,255,0.9)';
    for (const star of world.bgStars) {
        ctx.beginPath();
        ctx.arc(star.x, star.y, star.r, 0, Math.PI * 2);
        ctx.fill();
    }

    // 玩家
    if (player) {
        const blink = player.invincibleTimer > 0 && Math.floor(performance.now() / 100) % 2 === 0;
        if (!blink) {
            drawShip(player.x, player.y, player.w, player.h, '#86e1ff');
        }
    }

    // 子弹（渐变颜色，按种类）
    for (const b of bullets) {
        const headY = Math.min(b.y, b.y + b.h);
        const tailY = Math.max(b.y, b.y + b.h);
        const grad = ctx.createLinearGradient(b.x, headY, b.x, tailY);
        if (b.kind === 'laser') {
            grad.addColorStop(0, '#ffffff');
            grad.addColorStop(0.35, '#d8fbff');
            grad.addColorStop(1, '#44b6ff');
        } else if (b.kind === 'spread') {
            grad.addColorStop(0, '#fff2a8');
            grad.addColorStop(0.5, '#ffc23b');
            grad.addColorStop(1, '#ff7b00');
        } else if (b.kind === 'rocket') {
            grad.addColorStop(0, '#ffd6a0');
            grad.addColorStop(0.5, '#ff8a3b');
            grad.addColorStop(1, '#c14600');
        } else if (b.kind === 'plasma') {
            grad.addColorStop(0, '#e0f7ff');
            grad.addColorStop(0.5, '#9cf');
            grad.addColorStop(1, '#6ad1ff');
        } else {
            grad.addColorStop(0, '#fff7b8');
            grad.addColorStop(1, '#ffcf33');
        }
        ctx.fillStyle = grad;
        ctx.fillRect(b.x, b.y, b.w, b.h);
    }

    // 敌机
    for (const e of enemies) {
        drawShip(e.x, e.y, e.w, e.h, e.color || '#ff6b6b', true);
    }

    // 道具
    for (const p of powerups) {
        drawPowerup(p);
    }

    // 爆炸效果
    for (const ex of explosions) {
        drawExplosion(ex);
    }
    // 电弧效果
    for (const a of arcs) {
        drawArc(a);
    }
}

function drawShip(x, y, w, h, color, invert = false) {
    ctx.save();
    ctx.translate(x + w / 2, y + h / 2);
    ctx.scale(1, invert ? -1 : 1);
    ctx.translate(-w / 2, -h / 2);
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.moveTo(w / 2, 0);
    ctx.lineTo(w, h * 0.7);
    ctx.lineTo(w * 0.65, h * 0.7);
    ctx.lineTo(w * 0.55, h);
    ctx.lineTo(w * 0.45, h);
    ctx.lineTo(w * 0.35, h * 0.7);
    ctx.lineTo(0, h * 0.7);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
}

function drawPowerup(p) {
    ctx.save();
    ctx.translate(p.x + p.w / 2, p.y + p.h / 2);
    ctx.rotate(Math.sin(p.t / 180) * 0.2);
    ctx.translate(-p.w / 2, -p.h / 2);
    ctx.fillStyle = p.type === WeaponType.Laser ? '#7cf' : '#ffd166';
    ctx.strokeStyle = 'rgba(255,255,255,.7)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    if (ctx.roundRect) {
        ctx.roundRect(0, 0, p.w, p.h, 4);
    } else {
        // 兼容：用普通矩形
        ctx.rect(0, 0, p.w, p.h);
    }
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = '#000';
    ctx.font = '10px system-ui, Arial';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(p.type === WeaponType.Laser ? 'L' : 'S', p.w / 2, p.h / 2 + 0.5);
    ctx.restore();
}

function drawExplosion(ex) {
    const k = 1 - Math.min(1, ex.t / ex.life);
    const r = ex.r * (1 + 0.25 * (1 - k));
    const grad = ctx.createRadialGradient(ex.x, ex.y, 0, ex.x, ex.y, r);
    grad.addColorStop(0, `rgba(255,220,120,${0.5 * k})`);
    grad.addColorStop(0.5, `rgba(255,140,60,${0.35 * k})`);
    grad.addColorStop(1, 'rgba(255,120,0,0)');
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.arc(ex.x, ex.y, r, 0, Math.PI * 2);
    ctx.fill();
}

function drawArc(a) {
    const k = 1 - Math.min(1, a.t / a.life);
    ctx.strokeStyle = `rgba(120,210,255,${0.9 * k})`;
    ctx.lineWidth = 2.2;
    // 折线型随机抖动的电弧
    const segments = 6;
    const dx = (a.x2 - a.x1) / segments;
    const dy = (a.y2 - a.y1) / segments;
    ctx.beginPath();
    ctx.moveTo(a.x1, a.y1);
    for (let i = 1; i < segments; i++) {
        const nx = a.x1 + dx * i + (Math.random() - 0.5) * 6 * k;
        const ny = a.y1 + dy * i + (Math.random() - 0.5) * 6 * k;
        ctx.lineTo(nx, ny);
    }
    ctx.lineTo(a.x2, a.y2);
    ctx.stroke();
}

/* 主循环：固定步进更新，变步渲染 */
function loop(ts) {
    if (gameState !== State.Playing) return;
    const delta = ts - lastTime;
    lastTime = ts;
    accumulator += delta;

    while (accumulator >= fixedDt) {
        update(fixedDt);
        accumulator -= fixedDt;
    }
    render();
    requestAnimationFrame(loop);
}

// 初始在菜单界面，显示覆盖层
overlay.classList.add('show');


