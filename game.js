(() => {
  "use strict";

  const canvas = document.getElementById("gameCanvas");
  const ctx = canvas.getContext("2d", { alpha: false });
  const canvasFrame = document.getElementById("canvasFrame");
  const gameOverlay = document.getElementById("gameOverlay");
  const overlayKicker = document.getElementById("overlayKicker");
  const overlayTitle = document.getElementById("overlayTitle");
  const overlayCopy = document.getElementById("overlayCopy");
  const overlayResult = document.getElementById("overlayResult");
  const finalScore = document.getElementById("finalScore");
  const bestScore = document.getElementById("bestScore");
  const startButton = document.getElementById("startButton");
  const pauseButton = document.getElementById("pauseButton");
  const fullscreenButton = document.getElementById("fullscreenButton");
  const soundToggle = document.getElementById("soundToggle");
  const helpButton = document.getElementById("helpButton");
  const footerHelpButton = document.getElementById("footerHelpButton");
  const infoDialog = document.getElementById("infoDialog");
  const closeDialogButton = document.getElementById("closeDialogButton");
  const shareButton = document.getElementById("shareButton");
  const shareNote = document.getElementById("shareNote");
  const stageStatus = document.getElementById("stageStatus");
  const speedBadge = document.getElementById("speedBadge");
  const liveScore = document.getElementById("liveScore");
  const sideScore = document.getElementById("sideScore");
  const sideBest = document.getElementById("sideBest");
  const totalRuns = document.getElementById("totalRuns");
  const timeOfDay = document.getElementById("timeOfDay");
  const speedStat = document.getElementById("speedStat");
  const scoreNote = document.getElementById("scoreNote");
  const jumpButton = document.getElementById("jumpButton");
  const duckButton = document.getElementById("duckButton");

  const GAME_WIDTH = 1280;
  const GAME_HEIGHT = 720;
  const GROUND_Y = 590;
  const PLAYER_X = 184;
  const STAND_WIDTH = 68;
  const STAND_HEIGHT = 68;
  const DUCK_WIDTH = 78;
  const DUCK_HEIGHT = 42;
  const GRAVITY = 2350;
  const JUMP_VELOCITY = -910;
  const BASE_SPEED = 390;
  const MAX_SPEED = 1260;
  const SPEED_GAIN_PER_SCORE = 0.68;
  const SPEED_TIER_STEP = 0.2;
  const CAMPUS_CYCLE = 1540;

  const storage = {
    get(key, fallback) {
      try {
        const value = window.localStorage.getItem(key);
        return value === null ? fallback : JSON.parse(value);
      } catch {
        return fallback;
      }
    },
    set(key, value) {
      try {
        window.localStorage.setItem(key, JSON.stringify(value));
      } catch {
        // The game remains playable when browser storage is unavailable.
      }
    },
  };

  const savedBest = Number(storage.get("scut-run-best", 0)) || 0;
  const savedRuns = Number(storage.get("scut-run-runs", 0)) || 0;
  const soundPreference = storage.get("scut-run-sound", true) !== false;

  const state = {
    mode: "ready",
    time: 0,
    distance: 0,
    score: 0,
    speed: BASE_SPEED,
    spawnTimer: 1.35,
    obstacles: [],
    particles: [],
    petals: [],
    clouds: [],
    stars: [],
    night: 0,
    milestone: 0,
    shake: 0,
    speedPulse: 0,
    speedTier: 0,
    doubleJumpPulse: 0,
    best: savedBest,
    runs: savedRuns,
    lastObstacleType: "tree",
    spawnCount: 0,
    soundOn: soundPreference,
    pointer: null,
    logoReady: false,
  };

  const player = {
    x: PLAYER_X,
    y: GROUND_Y - STAND_HEIGHT,
    w: STAND_WIDTH,
    h: STAND_HEIGHT,
    vy: 0,
    grounded: true,
    jumpCount: 0,
    jumpBuffer: 0,
    coyote: 0.12,
    ducking: false,
  };

  const keys = {
    jump: false,
    duck: false,
  };

  const logoImage = new Image();
  logoImage.decoding = "async";
  logoImage.onload = () => {
    state.logoReady = true;
  };
  logoImage.onerror = () => {
    state.logoReady = false;
  };
  logoImage.src = "./assets/scut-logo.svg";

  const audio = {
    context: null,
    master: null,

    unlock() {
      if (!state.soundOn) return;
      if (!this.context) {
        const AudioContext = window.AudioContext || window.webkitAudioContext;
        if (!AudioContext) return;
        this.context = new AudioContext();
        this.master = this.context.createGain();
        this.master.gain.value = 0.2;
        this.master.connect(this.context.destination);
      }
      if (this.context.state === "suspended") {
        this.context.resume();
      }
    },

    tone(frequency, duration, type = "square", volume = 0.16, slide = 0) {
      if (!state.soundOn) return;
      this.unlock();
      if (!this.context || !this.master) return;

      const now = this.context.currentTime;
      const oscillator = this.context.createOscillator();
      const gain = this.context.createGain();
      oscillator.type = type;
      oscillator.frequency.setValueAtTime(frequency, now);
      if (slide) {
        oscillator.frequency.exponentialRampToValueAtTime(
          Math.max(40, frequency + slide),
          now + duration,
        );
      }
      gain.gain.setValueAtTime(0.0001, now);
      gain.gain.exponentialRampToValueAtTime(volume, now + 0.015);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + duration);
      oscillator.connect(gain);
      gain.connect(this.master);
      oscillator.start(now);
      oscillator.stop(now + duration + 0.03);
    },

    start() {
      this.tone(330, 0.11, "square", 0.11, 220);
      window.setTimeout(() => this.tone(494, 0.16, "square", 0.1, 180), 90);
    },

    jump() {
      this.tone(440, 0.13, "square", 0.1, 280);
    },

    doubleJump() {
      this.tone(590, 0.1, "triangle", 0.1, 330);
      window.setTimeout(() => this.tone(890, 0.13, "triangle", 0.08, 260), 55);
    },

    point() {
      this.tone(780, 0.08, "triangle", 0.11, 260);
    },

    faster() {
      this.tone(520, 0.08, "triangle", 0.09, 180);
      window.setTimeout(() => this.tone(690, 0.1, "triangle", 0.09, 220), 75);
      window.setTimeout(() => this.tone(880, 0.14, "triangle", 0.08, 260), 150);
    },

    warn() {
      this.tone(640, 0.08, "sine", 0.09, 120);
      window.setTimeout(() => this.tone(920, 0.12, "sine", 0.08, 90), 70);
    },

    crash() {
      this.tone(190, 0.35, "sawtooth", 0.18, -120);
      window.setTimeout(() => this.tone(105, 0.28, "square", 0.12, -45), 70);
    },
  };

  function clamp(value, min, max) {
    return Math.max(min, Math.min(max, value));
  }

  function lerp(start, end, amount) {
    return start + (end - start) * amount;
  }

  function hash(value) {
    const x = Math.sin(value * 127.1 + 311.7) * 43758.5453;
    return x - Math.floor(x);
  }

  function randomRange(min, max) {
    return min + Math.random() * (max - min);
  }

  function parseHex(hex) {
    const normalized = hex.replace("#", "");
    return {
      r: parseInt(normalized.slice(0, 2), 16),
      g: parseInt(normalized.slice(2, 4), 16),
      b: parseInt(normalized.slice(4, 6), 16),
    };
  }

  function mixHex(dayColor, nightColor, amount) {
    const day = parseHex(dayColor);
    const night = parseHex(nightColor);
    const mix = {
      r: Math.round(lerp(day.r, night.r, amount)),
      g: Math.round(lerp(day.g, night.g, amount)),
      b: Math.round(lerp(day.b, night.b, amount)),
    };
    return `rgb(${mix.r}, ${mix.g}, ${mix.b})`;
  }

  function dayNight(dayColor, nightColor) {
    return mixHex(dayColor, nightColor, state.night);
  }

  function roundedRect(context, x, y, width, height, radius) {
    const r = Math.min(radius, width / 2, height / 2);
    context.beginPath();
    context.moveTo(x + r, y);
    context.arcTo(x + width, y, x + width, y + height, r);
    context.arcTo(x + width, y + height, x, y + height, r);
    context.arcTo(x, y + height, x, y, r);
    context.arcTo(x, y, x + width, y, r);
    context.closePath();
  }

  function formatScore(value) {
    return String(Math.max(0, Math.floor(value))).padStart(5, "0");
  }

  function drawEllipse(context, x, y, radiusX, radiusY, color) {
    context.beginPath();
    context.ellipse(x, y, radiusX, radiusY, 0, 0, Math.PI * 2);
    context.fillStyle = color;
    context.fill();
  }

  function setupCanvas() {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = Math.round(GAME_WIDTH * dpr);
    canvas.height = Math.round(GAME_HEIGHT * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.imageSmoothingEnabled = true;
  }

  function createAmbientScene() {
    state.clouds = Array.from({ length: 7 }, (_, index) => ({
      x: hash(index * 3.1) * GAME_WIDTH,
      y: 74 + hash(index * 5.7) * 185,
      scale: 0.7 + hash(index * 7.2) * 0.75,
      speed: 8 + hash(index * 9.3) * 16,
    }));

    state.stars = Array.from({ length: 74 }, (_, index) => ({
      x: hash(index * 2.2) * GAME_WIDTH,
      y: 28 + hash(index * 4.9) * 330,
      radius: 0.8 + hash(index * 6.1) * 1.7,
      phase: hash(index * 8.8) * Math.PI * 2,
    }));

    state.petals = Array.from({ length: 34 }, (_, index) => ({
      x: hash(index * 5.4) * GAME_WIDTH,
      y: 92 + hash(index * 3.8) * 390,
      scale: 0.55 + hash(index * 7.3) * 0.8,
      speed: 18 + hash(index * 9.7) * 32,
      drift: 12 + hash(index * 11.1) * 20,
      phase: hash(index * 13.7) * Math.PI * 2,
      rotation: hash(index * 17.2) * Math.PI,
    }));
  }

  function makeParticles(x, y, color, amount = 14, force = 260) {
    for (let index = 0; index < amount; index += 1) {
      const angle = Math.random() * Math.PI * 2;
      const speed = force * (0.35 + Math.random() * 0.65);
      state.particles.push({
        x,
        y,
        vx: Math.cos(angle) * speed - state.speed * 0.12,
        vy: Math.sin(angle) * speed - 90,
        life: 0.55 + Math.random() * 0.45,
        maxLife: 1,
        size: 3 + Math.random() * 7,
        color,
        rotation: Math.random() * Math.PI,
        spin: randomRange(-7, 7),
      });
    }
  }

  function updateParticles(dt) {
    for (let index = state.particles.length - 1; index >= 0; index -= 1) {
      const particle = state.particles[index];
      particle.life -= dt;
      if (particle.life <= 0) {
        state.particles.splice(index, 1);
        continue;
      }
      particle.x += particle.vx * dt;
      particle.y += particle.vy * dt;
      particle.vy += 420 * dt;
      particle.rotation += particle.spin * dt;
    }
  }

  function drawParticles() {
    for (const particle of state.particles) {
      const alpha = clamp(particle.life / particle.maxLife, 0, 1);
      ctx.save();
      ctx.globalAlpha = alpha;
      ctx.translate(particle.x, particle.y);
      ctx.rotate(particle.rotation);
      ctx.fillStyle = particle.color;
      ctx.fillRect(-particle.size / 2, -particle.size / 4, particle.size, particle.size / 2);
      ctx.restore();
    }
  }

  function updateAmbient(dt) {
    for (const cloud of state.clouds) {
      cloud.x -= (cloud.speed + state.speed * 0.008) * dt;
      if (cloud.x < -220 * cloud.scale) {
        cloud.x = GAME_WIDTH + 180 * cloud.scale;
        cloud.y = 70 + Math.random() * 190;
      }
    }

    for (const petal of state.petals) {
      petal.x -= (petal.speed + state.speed * 0.025) * dt;
      petal.y += Math.sin(state.time * 1.8 + petal.phase) * petal.drift * dt;
      petal.rotation += dt * 1.8;
      if (petal.x < -20) {
        petal.x = GAME_WIDTH + Math.random() * 140;
        petal.y = 60 + Math.random() * 410;
      }
    }
  }

  function drawSky() {
    const skyGradient = ctx.createLinearGradient(0, 0, 0, GROUND_Y + 60);
    skyGradient.addColorStop(0, dayNight("#8dc8df", "#101d36"));
    skyGradient.addColorStop(0.62, dayNight("#c4e4e5", "#2a3d5a"));
    skyGradient.addColorStop(1, dayNight("#f2dfbb", "#4a5768"));
    ctx.fillStyle = skyGradient;
    ctx.fillRect(0, 0, GAME_WIDTH, GAME_HEIGHT);

    if (state.night > 0.01) {
      for (const star of state.stars) {
        const twinkle = 0.55 + Math.sin(state.time * 2.2 + star.phase) * 0.35;
        ctx.globalAlpha = state.night * twinkle;
        ctx.fillStyle = "#fff7d1";
        ctx.beginPath();
        ctx.arc(star.x, star.y, star.radius, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.globalAlpha = 1;
    }

    const sunX = 1080;
    const sunY = 105;
    ctx.save();
    ctx.globalAlpha = 1 - state.night;
    ctx.fillStyle = "#ffd66f";
    ctx.beginPath();
    ctx.arc(sunX, sunY, 38, 0, Math.PI * 2);
    ctx.fill();
    ctx.globalAlpha = state.night;
    ctx.fillStyle = "#f3efd8";
    ctx.beginPath();
    ctx.arc(sunX, sunY, 30, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = dayNight("#9acfe1", "#293b57");
    ctx.beginPath();
    ctx.arc(sunX + 10, sunY - 8, 29, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();

    for (const cloud of state.clouds) {
      drawCloud(cloud);
    }
  }

  function drawCloud(cloud) {
    ctx.save();
    ctx.translate(cloud.x, cloud.y);
    ctx.scale(cloud.scale, cloud.scale);
    ctx.globalAlpha = lerp(0.72, 0.18, state.night);
    ctx.fillStyle = dayNight("#f8fbf5", "#aeb8d1");
    ctx.beginPath();
    ctx.arc(0, 18, 28, Math.PI, 0);
    ctx.arc(34, 8, 38, Math.PI, 0);
    ctx.arc(79, 18, 29, Math.PI, 0);
    ctx.arc(44, 31, 44, Math.PI, 0);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  }

  function drawFarSkyline(offset) {
    const cycle = 1780;
    const shift = offset % cycle;
    ctx.save();
    ctx.translate(-shift, 0);
    ctx.globalAlpha = lerp(0.28, 0.18, state.night);
    ctx.fillStyle = dayNight("#718b91", "#101a2d");

    for (let repeat = -1; repeat <= 2; repeat += 1) {
      const baseX = repeat * cycle;
      ctx.fillRect(baseX + 20, 396, 88, 154);
      ctx.fillRect(baseX + 124, 438, 62, 112);
      ctx.fillRect(baseX + 204, 365, 108, 185);
      ctx.fillRect(baseX + 332, 424, 91, 126);
      ctx.fillRect(baseX + 447, 342, 70, 208);
      ctx.fillRect(baseX + 540, 411, 126, 139);
      ctx.fillRect(baseX + 690, 375, 95, 175);
      ctx.fillRect(baseX + 807, 451, 148, 99);
      ctx.fillRect(baseX + 979, 402, 83, 148);
      ctx.fillRect(baseX + 1087, 354, 124, 196);
      ctx.fillRect(baseX + 1234, 427, 111, 123);
      ctx.fillRect(baseX + 1374, 385, 92, 165);
      ctx.fillRect(baseX + 1491, 445, 147, 105);

      ctx.lineWidth = 8;
      ctx.strokeStyle = ctx.fillStyle;
      ctx.beginPath();
      ctx.moveTo(baseX + 482, 342);
      ctx.lineTo(baseX + 482, 208);
      ctx.lineTo(baseX + 646, 342);
      ctx.stroke();
    }

    ctx.restore();
  }

  function drawBuildingLabel(text, x, y) {
    ctx.save();
    ctx.font = '700 15px "Microsoft YaHei", "PingFang SC", sans-serif';
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    const width = ctx.measureText(text).width + 20;
    roundedRect(ctx, x - width / 2, y - 12, width, 24, 4);
    ctx.fillStyle = dayNight("rgba(255,253,248,0.84)", "rgba(18,29,48,0.82)");
    ctx.fill();
    ctx.fillStyle = dayNight("#741c30", "#f2d98e");
    ctx.fillText(text, x, y + 1);
    ctx.restore();
  }

  function drawYifu(x, base) {
    ctx.save();
    ctx.translate(x, base);
    ctx.scale(0.9, 0.9);

    ctx.fillStyle = dayNight("#c9cec6", "#25344b");
    ctx.fillRect(12, -106, 290, 96);
    ctx.fillStyle = dayNight("#adb8b2", "#1c293f");
    ctx.fillRect(12, -116, 290, 12);
    ctx.fillStyle = dayNight("#7e8f8c", "#111c31");
    ctx.fillRect(18, -130, 76, 14);
    ctx.fillRect(218, -130, 76, 14);

    ctx.fillStyle = dayNight("#c4ddd9", "#17314a");
    ctx.fillRect(94, -171, 126, 159);
    ctx.fillStyle = dayNight("#6f8f91", "#17273d");
    ctx.fillRect(94, -174, 126, 9);
    ctx.fillRect(90, -16, 134, 12);

    for (let row = 0; row < 6; row += 1) {
      for (let column = 0; column < 4; column += 1) {
        const lit = state.night > 0.35 && (row * 4 + column) % 7 === 0;
        ctx.fillStyle = lit
          ? "#f0c96a"
          : dayNight("#8eb3b4", "#13283e");
        ctx.fillRect(106 + column * 27, -156 + row * 23, 20, 14);
      }
    }

    for (let row = 0; row < 3; row += 1) {
      for (let column = 0; column < 5; column += 1) {
        const lit = state.night > 0.35 && (row + column) % 8 === 0;
        ctx.fillStyle = lit ? "#efc35d" : dayNight("#9eaea8", "#203047");
        ctx.fillRect(25 + column * 54, -91 + row * 24, 34, 14);
      }
    }

    ctx.fillStyle = "#8f2438";
    ctx.fillRect(83, -169, 148, 23);
    ctx.fillStyle = "#f4d98c";
    ctx.font = '900 15px "Microsoft YaHei", sans-serif';
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText("逸夫科技馆", 157, -157);
    ctx.restore();

    drawBuildingLabel("逸夫科技馆", x + 145, base - 184);
  }

  function drawLibrary(x, base) {
    ctx.save();
    ctx.translate(x, base);
    ctx.scale(0.9, 0.9);

    ctx.fillStyle = dayNight("#d2c9b5", "#273348");
    ctx.fillRect(15, -122, 224, 112);
    ctx.fillStyle = dayNight("#a99e89", "#1b283c");
    ctx.fillRect(5, -132, 244, 14);
    ctx.beginPath();
    ctx.moveTo(5, -132);
    ctx.lineTo(42, -153);
    ctx.lineTo(207, -153);
    ctx.lineTo(244, -132);
    ctx.closePath();
    ctx.fillStyle = dayNight("#827866", "#172338");
    ctx.fill();

    ctx.fillStyle = dayNight("#e0d6c1", "#304057");
    ctx.fillRect(83, -187, 88, 177);
    ctx.fillStyle = dayNight("#988c76", "#1b293d");
    ctx.fillRect(73, -195, 108, 14);
    ctx.beginPath();
    ctx.moveTo(73, -195);
    ctx.lineTo(91, -217);
    ctx.lineTo(163, -217);
    ctx.lineTo(181, -195);
    ctx.closePath();
    ctx.fill();

    for (let row = 0; row < 4; row += 1) {
      for (let column = 0; column < 6; column += 1) {
        const lit = state.night > 0.35 && (row * 2 + column) % 9 === 0;
        ctx.fillStyle = lit ? "#efc461" : dayNight("#8ca7ab", "#182b42");
        ctx.fillRect(28 + column * 33, -107 + row * 25, 18, 14);
        if (column < 2 || column > 3) {
          ctx.fillRect(104 + column * 11, -174 + row * 30, 5, 19);
        }
      }
    }

    ctx.beginPath();
    ctx.arc(127, -164, 13, 0, Math.PI * 2);
    ctx.fillStyle = dayNight("#f3dfab", "#e7c866");
    ctx.fill();
    ctx.strokeStyle = dayNight("#741c30", "#f3d98e");
    ctx.lineWidth = 3;
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(127, -164);
    ctx.lineTo(127, -173);
    ctx.moveTo(127, -164);
    ctx.lineTo(134, -161);
    ctx.stroke();
    ctx.restore();

    drawBuildingLabel("图书馆", x + 126, base - 235);
  }

  function drawBuilding6(x, base) {
    ctx.save();
    ctx.translate(x, base);
    ctx.scale(0.9, 0.9);

    ctx.fillStyle = dayNight("#9f5d52", "#3c2c3d");
    ctx.fillRect(12, -116, 210, 106);
    ctx.fillStyle = dayNight("#7c403b", "#302338");
    ctx.fillRect(5, -128, 224, 14);
    ctx.beginPath();
    ctx.moveTo(4, -128);
    ctx.lineTo(46, -154);
    ctx.lineTo(188, -154);
    ctx.lineTo(230, -128);
    ctx.closePath();
    ctx.fillStyle = dayNight("#643334", "#261d32");
    ctx.fill();

    for (let row = 0; row < 3; row += 1) {
      for (let column = 0; column < 6; column += 1) {
        const windowX = 26 + column * 31;
        const windowY = -101 + row * 29;
        ctx.beginPath();
        ctx.moveTo(windowX, windowY + 15);
        ctx.lineTo(windowX, windowY + 6);
        ctx.arc(windowX + 8, windowY + 6, 8, Math.PI, 0);
        ctx.lineTo(windowX + 16, windowY + 15);
        ctx.closePath();
        ctx.fillStyle =
          state.night > 0.35 && (row + column) % 8 === 0
            ? "#efc96d"
            : dayNight("#e2c59c", "#18273d");
        ctx.fill();
      }
    }

    ctx.fillStyle = dayNight("#5d3033", "#211a2d");
    ctx.fillRect(102, -34, 30, 28);
    ctx.restore();

    drawBuildingLabel("六号楼", x + 115, base - 173);
  }

  function drawGateStone(x, base) {
    ctx.save();
    ctx.translate(x, base);
    ctx.scale(0.9, 0.9);
    ctx.fillStyle = dayNight("#b8aa8c", "#303447");
    ctx.beginPath();
    ctx.moveTo(8, 0);
    ctx.lineTo(0, -35);
    ctx.lineTo(13, -64);
    ctx.lineTo(70, -78);
    ctx.lineTo(145, -66);
    ctx.lineTo(164, -31);
    ctx.lineTo(151, 0);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = dayNight("#e0d0aa", "#4a4c5b");
    ctx.fillRect(18, -48, 120, 20);
    ctx.fillStyle = "#9b2638";
    ctx.font = '900 22px "Microsoft YaHei", serif';
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText("华南理工大学", 78, -37);
    ctx.restore();
  }

  function drawSundial(x, base) {
    ctx.save();
    ctx.translate(x, base);
    ctx.scale(0.9, 0.9);
    ctx.fillStyle = dayNight("#b8b6a8", "#27344a");
    ctx.fillRect(20, -18, 42, 18);
    ctx.fillRect(29, -44, 24, 26);
    ctx.fillStyle = dayNight("#d6d3be", "#35435a");
    ctx.beginPath();
    ctx.ellipse(41, -47, 33, 9, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = dayNight("#545c5d", "#d5c47d");
    ctx.lineWidth = 4;
    ctx.beginPath();
    ctx.moveTo(41, -51);
    ctx.lineTo(59, -84);
    ctx.stroke();
    ctx.restore();
    drawBuildingLabel("日晷台", x + 38, base - 98);
  }

  function drawCampusLandmarks(offset) {
    const shift = ((offset % CAMPUS_CYCLE) + CAMPUS_CYCLE) % CAMPUS_CYCLE;
    ctx.save();
    ctx.translate(-shift, 0);

    for (let repeat = -1; repeat <= 2; repeat += 1) {
      const x = repeat * CAMPUS_CYCLE;
      drawYifu(x + 15, GROUND_Y + 2);
      drawLibrary(x + 350, GROUND_Y + 2);
      drawBuilding6(x + 690, GROUND_Y + 2);
      drawSundial(x + 938, GROUND_Y + 2);
      drawGateStone(x + 1075, GROUND_Y + 2);
    }

    ctx.restore();
  }

  function drawHorizonTrees(offset) {
    const shift = ((offset % 260) + 260) % 260;
    ctx.save();
    ctx.translate(-shift, 0);
    ctx.globalAlpha = lerp(0.38, 0.24, state.night);

    for (let repeat = -1; repeat <= 7; repeat += 1) {
      const x = repeat * 260 + 36;
      ctx.fillStyle = dayNight("#506e4c", "#12252f");
      ctx.fillRect(x + 20, GROUND_Y - 48, 7, 48);
      ctx.beginPath();
      ctx.arc(x + 23, GROUND_Y - 59, 28, 0, Math.PI * 2);
      ctx.arc(x, GROUND_Y - 45, 22, 0, Math.PI * 2);
      ctx.arc(x + 49, GROUND_Y - 44, 23, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = dayNight("#a92e42", "#6d2942");
      for (let blossom = 0; blossom < 7; blossom += 1) {
        const bx = x - 16 + hash(repeat * 19 + blossom * 3.2) * 76;
        const by = GROUND_Y - 79 + hash(repeat * 23 + blossom * 5.1) * 44;
        ctx.beginPath();
        ctx.arc(bx, by, 5 + hash(blossom * 4.7) * 3, 0, Math.PI * 2);
        ctx.fill();
      }
    }

    ctx.restore();
  }

  function drawGround(offset) {
    ctx.fillStyle = dayNight("#718453", "#253638");
    ctx.fillRect(0, GROUND_Y, GAME_WIDTH, GAME_HEIGHT - GROUND_Y);

    ctx.fillStyle = dayNight("#d8c9a8", "#4d5360");
    ctx.fillRect(0, GROUND_Y, GAME_WIDTH, 20);
    ctx.fillStyle = dayNight("#a89370", "#323b4a");
    ctx.fillRect(0, GROUND_Y + 20, GAME_WIDTH, 5);

    ctx.fillStyle = dayNight("#7f6b50", "#283544");
    const markerShift = ((offset % 178) + 178) % 178;
    for (let x = -markerShift; x < GAME_WIDTH + 40; x += 178) {
      ctx.fillRect(x, GROUND_Y + 85, 70, 6);
    }

    ctx.globalAlpha = 0.2;
    ctx.strokeStyle = dayNight("#35472f", "#18272c");
    ctx.lineWidth = 3;
    for (let x = -((offset * 0.72) % 54); x < GAME_WIDTH + 54; x += 54) {
      ctx.beginPath();
      ctx.moveTo(x, GROUND_Y + 35);
      ctx.lineTo(x + 18, GROUND_Y + 48);
      ctx.moveTo(x + 18, GROUND_Y + 35);
      ctx.lineTo(x, GROUND_Y + 48);
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
  }

  function drawSpeedStreaks() {
    if (state.speedPulse <= 0.01 || state.mode !== "running") return;
    ctx.save();
    ctx.globalAlpha = state.speedPulse * 0.22;
    ctx.strokeStyle = dayNight("#fff7dc", "#bfe7ff");
    ctx.lineWidth = 3;
    ctx.lineCap = "round";
    const shift = (state.time * state.speed * 1.7) % 190;
    for (let index = -1; index < 8; index += 1) {
      const x = index * 190 - shift;
      const y = 118 + hash(index * 4.6) * 330;
      const length = 54 + state.speedPulse * 80;
      ctx.beginPath();
      ctx.moveTo(x, y);
      ctx.lineTo(x + length, y);
      ctx.stroke();
    }
    ctx.restore();
  }

  function drawPetals() {
    ctx.save();
    ctx.globalAlpha = lerp(0.68, 0.34, state.night);
    for (const petal of state.petals) {
      ctx.save();
      ctx.translate(petal.x, petal.y);
      ctx.rotate(petal.rotation);
      ctx.scale(petal.scale, petal.scale);
      ctx.fillStyle = dayNight("#f0a6a3", "#b17d9b");
      ctx.beginPath();
      ctx.moveTo(-7, 0);
      ctx.quadraticCurveTo(-2, -7, 7, -2);
      ctx.quadraticCurveTo(3, 6, -7, 0);
      ctx.fill();
      ctx.restore();
    }
    ctx.restore();
  }

  function drawBlossomCluster(x, y, scale, phase) {
    const sway = Math.sin(state.time * 1.8 + phase) * 1.4;
    const blossomPositions = [
      [0, 0, 12],
      [-12, 5, 10],
      [12, 6, 11],
      [-5, -10, 9],
      [7, -12, 8],
      [-17, -5, 7],
      [18, -4, 8],
    ];
    ctx.save();
    ctx.translate(x + sway, y);
    ctx.scale(scale, scale);
    for (let index = 0; index < blossomPositions.length; index += 1) {
      const [bx, by, radius] = blossomPositions[index];
      ctx.fillStyle =
        index % 3 === 0
          ? dayNight("#f27668", "#b65064")
          : dayNight("#c92f45", "#8f344f");
      ctx.beginPath();
      ctx.arc(bx, by, radius, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = dayNight("#ffd3a1", "#e8bd79");
      ctx.beginPath();
      ctx.arc(bx - 2, by - 2, 2.3, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  }

  function drawKapok(obstacle) {
    const sway = Math.sin(state.time * 2 + obstacle.phase) * 0.018;
    ctx.save();
    ctx.translate(obstacle.x + obstacle.width / 2, obstacle.baseY);
    ctx.rotate(sway);

    drawEllipse(ctx, 0, 4, obstacle.width * 0.43, 8, "rgba(24,37,31,0.22)");

    if (obstacle.variant === 2) {
      ctx.fillStyle = dayNight("#65402f", "#292a35");
      ctx.beginPath();
      ctx.moveTo(-43, 0);
      ctx.lineTo(-35, -76);
      ctx.lineTo(-23, -91);
      ctx.lineTo(-14, -9);
      ctx.lineTo(7, -9);
      ctx.lineTo(18, -91);
      ctx.lineTo(30, -76);
      ctx.lineTo(39, 0);
      ctx.closePath();
      ctx.fill();
      ctx.strokeStyle = dayNight("#73513d", "#343746");
      ctx.lineWidth = 7;
      ctx.lineCap = "round";
      ctx.beginPath();
      ctx.moveTo(-28, -63);
      ctx.lineTo(-50, -86);
      ctx.moveTo(23, -68);
      ctx.lineTo(49, -91);
      ctx.stroke();
      drawBlossomCluster(-34, -94, 0.86, obstacle.phase);
      drawBlossomCluster(35, -103, 0.96, obstacle.phase + 1.4);
      drawBlossomCluster(0, -78, 0.72, obstacle.phase + 2.7);
    } else {
      const height = obstacle.height;
      const trunkWidth = obstacle.variant === 1 ? 24 : 21;
      ctx.fillStyle = dayNight("#65402f", "#292a35");
      ctx.beginPath();
      ctx.moveTo(-trunkWidth / 2 - 8, 0);
      ctx.lineTo(-trunkWidth / 2 - 2, -height + 38);
      ctx.lineTo(-5, -height + 5);
      ctx.lineTo(6, -height + 5);
      ctx.lineTo(trunkWidth / 2 + 3, -height + 40);
      ctx.lineTo(trunkWidth / 2 + 11, 0);
      ctx.closePath();
      ctx.fill();

      const branchY = -height + (obstacle.variant === 1 ? 43 : 34);
      ctx.strokeStyle = dayNight("#73513d", "#343746");
      ctx.lineWidth = obstacle.variant === 1 ? 9 : 8;
      ctx.lineCap = "round";
      ctx.beginPath();
      ctx.moveTo(-4, branchY);
      ctx.lineTo(-obstacle.width * 0.31, branchY - 27);
      ctx.moveTo(5, branchY - 9);
      ctx.lineTo(obstacle.width * 0.31, branchY - 39);
      ctx.stroke();

      const crownScale = obstacle.variant === 1 ? 1.02 : 0.92;
      drawBlossomCluster(-obstacle.width * 0.25, branchY - 34, crownScale, obstacle.phase);
      drawBlossomCluster(obstacle.width * 0.23, branchY - 45, crownScale, obstacle.phase + 1.5);
      drawBlossomCluster(0, -height + 5, crownScale * 0.9, obstacle.phase + 2.8);
    }

    ctx.restore();
  }

  function drawMagpie(obstacle) {
    const flap = Math.sin(state.time * 15 + obstacle.phase) * 0.75;
    ctx.save();
    ctx.translate(obstacle.x + obstacle.width / 2, obstacle.y + obstacle.height / 2);

    ctx.fillStyle = "rgba(24,37,31,0.15)";
    ctx.beginPath();
    ctx.ellipse(0, obstacle.height / 2 + 8, obstacle.width * 0.36, 4, 0, 0, Math.PI * 2);
    ctx.fill();

    ctx.globalAlpha = 0.34;
    ctx.strokeStyle = dayNight("#2768ad", "#7ab9f0");
    ctx.lineWidth = 3;
    ctx.lineCap = "round";
    ctx.beginPath();
    ctx.moveTo(-32, -5);
    ctx.lineTo(-54, -5);
    ctx.moveTo(-28, 7);
    ctx.lineTo(-48, 9);
    ctx.stroke();
    ctx.globalAlpha = 1;

    ctx.fillStyle = dayNight("#2469bd", "#377ed2");
    ctx.beginPath();
    ctx.ellipse(0, 0, 25, 15, -0.12, 0, Math.PI * 2);
    ctx.fill();

    ctx.fillStyle = dayNight("#78c9ee", "#91d7ff");
    ctx.beginPath();
    ctx.moveTo(-6, -8);
    ctx.lineTo(-31, -20 - flap * 15);
    ctx.lineTo(-15, 0);
    ctx.closePath();
    ctx.fill();

    ctx.fillStyle = dayNight("#1b4f92", "#235da8");
    ctx.beginPath();
    ctx.moveTo(-11, -1);
    ctx.lineTo(-47, -14);
    ctx.lineTo(-31, 1);
    ctx.lineTo(-48, 15);
    ctx.lineTo(-11, 7);
    ctx.closePath();
    ctx.fill();

    ctx.fillStyle = dayNight("#3d8bd6", "#5da5e6");
    ctx.beginPath();
    ctx.arc(16, -3, 13, 0, Math.PI * 2);
    ctx.fill();

    ctx.fillStyle = dayNight("#f3e8c9", "#ded5b8");
    ctx.beginPath();
    ctx.ellipse(1, 5, 11, 7, -0.1, 0, Math.PI * 2);
    ctx.fill();

    ctx.fillStyle = dayNight("#5ea9e0", "#79bff0");
    ctx.beginPath();
    ctx.moveTo(4, -5);
    ctx.lineTo(27, -18 + flap * 7);
    ctx.lineTo(22, 0);
    ctx.closePath();
    ctx.fill();

    ctx.fillStyle = "#f5f0d6";
    ctx.beginPath();
    ctx.arc(19, -7, 3, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = "#111c29";
    ctx.beginPath();
    ctx.arc(20, -7, 1.3, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = "#e29a43";
    ctx.beginPath();
    ctx.moveTo(27, -4);
    ctx.lineTo(38, -1);
    ctx.lineTo(27, 3);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  }

  function drawObstacles() {
    for (const obstacle of state.obstacles) {
      if (obstacle.type === "tree") {
        drawKapok(obstacle);
      } else {
        drawMagpie(obstacle);
      }
    }
  }

  function drawFallbackLogo(x, y, width, height) {
    ctx.save();
    ctx.translate(x + width / 2, y + height / 2);
    ctx.fillStyle = "#fffdf8";
    ctx.beginPath();
    ctx.arc(0, 0, width / 2, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = "#741c30";
    ctx.lineWidth = 5;
    ctx.stroke();
    ctx.fillStyle = "#741c30";
    ctx.font = `900 ${Math.round(width * 0.36)}px "Microsoft YaHei", sans-serif`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText("华工", 0, 2);
    ctx.restore();
  }

  function drawPlayer() {
    const centerX = player.x + player.w / 2;
    const baseY = player.y + player.h;
    const tilt = player.grounded ? Math.sin(state.time * 15) * 0.025 : -0.12;
    const duckScale = player.ducking ? 0.62 : 1;
    const speedRatio = clamp((state.speed - BASE_SPEED) / (MAX_SPEED - BASE_SPEED), 0, 1);

    ctx.save();
    if (state.shake > 0) {
      ctx.translate(randomRange(-state.shake, state.shake), randomRange(-state.shake, state.shake));
    }

    ctx.fillStyle = "rgba(23,37,31,0.22)";
    ctx.beginPath();
    ctx.ellipse(centerX, GROUND_Y + 6, player.w * 0.46, 8, 0, 0, Math.PI * 2);
    ctx.fill();

    if (state.doubleJumpPulse > 0.01) {
      const progress = 1 - state.doubleJumpPulse;
      ctx.save();
      ctx.globalAlpha = state.doubleJumpPulse * 0.7;
      ctx.strokeStyle = dayNight("#e6b84a", "#9ddfff");
      ctx.lineWidth = 5 - progress * 3;
      ctx.beginPath();
      ctx.ellipse(
        centerX,
        player.y + player.h / 2,
        player.w * (0.55 + progress * 0.75),
        player.h * (0.35 + progress * 0.42),
        0,
        0,
        Math.PI * 2,
      );
      ctx.stroke();
      ctx.restore();
    }

    ctx.globalAlpha = 0.25 + speedRatio * 0.32;
    ctx.strokeStyle = dayNight("#fff7dc", "#e4c665");
    ctx.lineWidth = 4;
    ctx.lineCap = "round";
    for (let index = 0; index < 3; index += 1) {
      const y = player.y + 17 + index * 15;
      const length =
        20 + index * 9 + speedRatio * 34 + Math.sin(state.time * 13 + index) * 4;
      ctx.beginPath();
      ctx.moveTo(player.x - 10 - length, y);
      ctx.lineTo(player.x - 15, y);
      ctx.stroke();
    }
    ctx.globalAlpha = 1;

    ctx.translate(centerX, baseY - player.h / 2);
    ctx.rotate(tilt);
    ctx.scale(1, duckScale);
    ctx.shadowColor = dayNight("rgba(39,57,68,0.25)", "rgba(235,198,95,0.34)");
    ctx.shadowBlur = state.night > 0.25 ? 18 : 7;
    ctx.shadowOffsetY = 4;

    if (state.logoReady) {
      ctx.drawImage(logoImage, -player.w / 2, -player.h / 2, player.w, player.h);
    } else {
      drawFallbackLogo(-player.w / 2, -player.h / 2, player.w, player.h);
    }
    ctx.restore();
  }

  function drawScene() {
    ctx.save();
    drawSky();
    drawFarSkyline(state.distance * 0.08);
    drawCampusLandmarks(state.distance * 0.22);
    drawHorizonTrees(state.distance * 0.42);
    drawPetals();
    drawGround(state.distance);
    drawSpeedStreaks();
    drawObstacles();
    drawPlayer();
    drawParticles();
    ctx.restore();
  }

  function groundObstacleTemplate(variant) {
    if (variant === 3) {
      return {
        width: 82,
        height: 200,
        hitbox: { x: 28, y: 14, w: 26, h: 186 },
      };
    }
    if (variant === 1) {
      return {
        width: 72,
        height: 138,
        hitbox: { x: 24, y: 12, w: 22, h: 126 },
      };
    }
    if (variant === 2) {
      return {
        width: 116,
        height: 111,
        hitbox: { x: 27, y: 13, w: 65, h: 98 },
      };
    }
    return {
      width: 64,
      height: 102,
      hitbox: { x: 21, y: 12, w: 20, h: 90 },
    };
  }

  function spawnObstacle() {
    const difficulty = clamp((state.score - 120) / 1100, 0, 1);
    const forcedBird =
      state.spawnCount >= 3 && (state.spawnCount - 3) % 5 === 0 && state.lastObstacleType !== "bird";
    const forcedTallTree =
      state.spawnCount >= 5 && (state.spawnCount - 5) % 6 === 0 && state.lastObstacleType !== "bird";
    const canSpawnBird =
      state.lastObstacleType !== "bird" &&
      (forcedBird || (state.score > 90 && Math.random() < 0.14 + difficulty * 0.12));
    let spawnedTallTree = false;

    if (canSpawnBird) {
      const width = 62;
      const height = 43;
      const y = GROUND_Y - 82;
      state.obstacles.push({
        type: "bird",
        x: GAME_WIDTH + 110,
        y,
        width,
        height,
        hitbox: { x: 9, y: 7, w: 49, h: 32 },
        phase: Math.random() * Math.PI * 2,
        passed: false,
      });
      state.lastObstacleType = "bird";
      stageStatus.textContent = "低空蓝喜鹊 · 按住向下键低头";
      audio.warn();
    } else {
      let variant = 0;
      if (forcedTallTree || (state.score > 180 && Math.random() < 0.08 + difficulty * 0.08)) {
        variant = 3;
        spawnedTallTree = true;
      } else if (Math.random() < 0.18 + difficulty * 0.18) {
        variant = 1;
      }
      if (state.score > 430 && Math.random() < 0.12 + difficulty * 0.18) {
        variant = 2;
      }
      const template = groundObstacleTemplate(variant);
      state.obstacles.push({
        type: "tree",
        variant,
        x: GAME_WIDTH + 100,
        y: GROUND_Y - template.height,
        baseY: GROUND_Y,
        width: template.width,
        height: template.height,
        hitbox: template.hitbox,
        phase: Math.random() * Math.PI * 2,
        passed: false,
      });
      state.lastObstacleType = "tree";
      stageStatus.textContent = spawnedTallTree
        ? "高木棉 · 需要二段跳"
        : "木棉树 · 跳跃";
      if (spawnedTallTree) audio.warn();
    }

    state.spawnCount += 1;
    const reactionDistance =
      320 + (spawnedTallTree ? 150 : 0) + state.speed * (0.46 + (spawnedTallTree ? 0.13 : 0) + Math.random() * 0.18);
    const breathingRoom = difficulty * randomRange(70, 180);
    state.spawnTimer = (reactionDistance + breathingRoom) / state.speed;
  }

  function queueJump() {
    if (state.mode !== "running") return;
    player.jumpBuffer = 0.13;
  }

  function applyJump() {
    const isDoubleJump = player.jumpCount >= 1;
    player.vy = isDoubleJump ? -880 : JUMP_VELOCITY;
    player.grounded = false;
    player.coyote = 0;
    player.jumpBuffer = 0;
    player.jumpCount = Math.min(2, player.jumpCount + 1);

    if (isDoubleJump) {
      state.doubleJumpPulse = 1;
      audio.doubleJump();
      makeParticles(
        player.x + player.w / 2,
        player.y + player.h,
        dayNight("#f4cf63", "#8bd8ff"),
        13,
        190,
      );
    } else {
      audio.jump();
      makeParticles(player.x + player.w / 2, GROUND_Y - 4, dayNight("#ddc69c", "#788596"), 7, 135);
    }
  }

  function updatePlayer(dt) {
    player.jumpBuffer = Math.max(0, player.jumpBuffer - dt);

    if (player.grounded) {
      player.coyote = 0.11;
    } else {
      player.coyote = Math.max(0, player.coyote - dt);
    }

    if (
      player.jumpBuffer > 0 &&
      (player.coyote > 0 || player.jumpCount < 2)
    ) {
      applyJump();
    }

    const targetHeight = player.ducking ? DUCK_HEIGHT : STAND_HEIGHT;
    const targetWidth = player.ducking ? DUCK_WIDTH : STAND_WIDTH;
    const wasGrounded = player.grounded;
    player.h = lerp(player.h, targetHeight, Math.min(1, dt * 28));
    player.w = lerp(player.w, targetWidth, Math.min(1, dt * 28));

    if (wasGrounded) {
      player.y = GROUND_Y - player.h;
      player.vy = 0;
      player.grounded = true;
      player.jumpCount = 0;
    } else {
      player.vy += GRAVITY * dt;
      if (keys.duck) {
        player.vy += GRAVITY * 0.48 * dt;
      }
      player.y += player.vy * dt;

      const floorY = GROUND_Y - player.h;
      if (player.y >= floorY) {
        makeParticles(
          player.x + player.w / 2,
          GROUND_Y - 4,
          dayNight("#ddc69c", "#788596"),
          5,
          90,
        );
        player.y = floorY;
        player.vy = 0;
        player.grounded = true;
        player.jumpCount = 0;
      } else {
        player.grounded = false;
      }
    }
  }

  function updateObstacles(dt) {
    for (let index = state.obstacles.length - 1; index >= 0; index -= 1) {
      const obstacle = state.obstacles[index];
      const obstacleSpeed = state.speed + (obstacle.type === "bird" ? 65 : 0);
      obstacle.x -= obstacleSpeed * dt;

      if (!obstacle.passed && obstacle.x + obstacle.width < player.x) {
        obstacle.passed = true;
        if (state.mode === "running") {
          stageStatus.textContent = "奔跑中";
        }
      }

      if (obstacle.x + obstacle.width < -120) {
        state.obstacles.splice(index, 1);
      }
    }
  }

  function playerHitbox() {
    if (player.ducking) {
      return {
        x: player.x + 14,
        y: player.y + 7,
        w: player.w - 28,
        h: player.h - 11,
      };
    }
    return {
      x: player.x + 11,
      y: player.y + 7,
      w: player.w - 22,
      h: player.h - 13,
    };
  }

  function obstacleHitbox(obstacle) {
    return {
      x: obstacle.x + obstacle.hitbox.x,
      y: obstacle.y + obstacle.hitbox.y,
      w: obstacle.hitbox.w,
      h: obstacle.hitbox.h,
    };
  }

  function boxesOverlap(first, second) {
    return (
      first.x < second.x + second.w &&
      first.x + first.w > second.x &&
      first.y < second.y + second.h &&
      first.y + first.h > second.y
    );
  }

  function checkCollisions() {
    const hitbox = playerHitbox();
    for (const obstacle of state.obstacles) {
      if (boxesOverlap(hitbox, obstacleHitbox(obstacle))) {
        endGame(obstacle);
        return;
      }
    }
  }

  function updateSpeed() {
    state.speed = Math.min(
      MAX_SPEED,
      BASE_SPEED + state.score * SPEED_GAIN_PER_SCORE,
    );

    const multiplier = state.speed / BASE_SPEED;
    const tier = Math.floor((multiplier - 1 + 0.0001) / SPEED_TIER_STEP);
    if (tier > state.speedTier) {
      state.speedTier = tier;
      state.speedPulse = 1;
      speedBadge.classList.remove("is-bump");
      void speedBadge.offsetWidth;
      speedBadge.classList.add("is-bump");
      window.setTimeout(() => speedBadge.classList.remove("is-bump"), 520);
      audio.faster();
      if (state.obstacles.length === 0) {
        stageStatus.textContent = `提速 · ×${multiplier.toFixed(2)}`;
      }
    }
  }

  function updateScore() {
    const nextScore = Math.floor(state.distance / 24);
    if (nextScore === state.score) return;

    state.score = nextScore;
    if (Math.floor(state.score / 100) > state.milestone) {
      state.milestone = Math.floor(state.score / 100);
      audio.point();
      makeParticles(890, 180, dayNight("#f4cf63", "#efd279"), 14, 220);
    }
    updateHud();
  }

  function updateNight() {
    const phase = Math.floor(state.score / 800) % 2;
    const target = state.score >= 800 && phase === 1 ? 1 : 0;
    state.night = lerp(state.night, target, 0.035);
    if (Math.abs(state.night - target) < 0.002) state.night = target;
  }

  function updateHud() {
    liveScore.textContent = formatScore(state.score);
    sideScore.textContent = formatScore(state.score);
    sideBest.textContent = formatScore(state.best);
    totalRuns.textContent = `${state.runs} 次`;
    timeOfDay.textContent = state.night > 0.5 ? "夜色" : "白日";
    const multiplier = state.speed / BASE_SPEED;
    speedBadge.textContent = `速度 ×${multiplier.toFixed(2)}`;
    speedStat.textContent = `×${multiplier.toFixed(2)}`;
    speedBadge.classList.toggle("is-fast", multiplier >= 1.5);

    if (state.score < 50) {
      scoreNote.textContent = "木棉跳，喜鹊低头，空中可再跳";
    } else if (state.score < 200) {
      scoreNote.textContent = "蓝喜鹊会低飞，按住向下键";
    } else if (state.score < 500) {
      scoreNote.textContent = "高木棉来了，准备二段跳";
    } else if (state.score < 800) {
      scoreNote.textContent = "校园线路开始加速";
    } else {
      scoreNote.textContent = state.night > 0.5 ? "华工夜色，路灯已亮" : "晨光重新回到校园";
    }
  }

  function showReadyScreen() {
    overlayKicker.textContent = "SCUT RUNNER";
    overlayTitle.textContent = "华工快跑";
    overlayCopy.textContent =
      "校徽带你沿五山校园线一路向前。支持二段跳，越跑越快，看看能跑多远。";
    overlayResult.hidden = true;
    startButton.textContent = "开始奔跑";
    gameOverlay.classList.remove("is-hidden");
    stageStatus.textContent = "待起跑";
    pauseButton.textContent = "暂停";
  }

  function resetGame() {
    state.mode = "ready";
    state.time = 0;
    state.distance = 0;
    state.score = 0;
    state.speed = BASE_SPEED;
    state.spawnTimer = 1.35;
    state.obstacles = [];
    state.particles = [];
    state.night = 0;
    state.milestone = 0;
    state.shake = 0;
    state.speedPulse = 0;
    state.speedTier = 0;
    state.doubleJumpPulse = 0;
    state.lastObstacleType = "tree";
    state.spawnCount = 0;
    player.x = PLAYER_X;
    player.w = STAND_WIDTH;
    player.h = STAND_HEIGHT;
    player.y = GROUND_Y - STAND_HEIGHT;
    player.vy = 0;
    player.grounded = true;
    player.jumpCount = 0;
    player.jumpBuffer = 0;
    player.coyote = 0.12;
    player.ducking = false;
    keys.jump = false;
    keys.duck = false;
    duckButton.classList.remove("is-active");
    updateHud();
    showReadyScreen();
  }

  function startGame() {
    if (state.mode === "running") return;
    state.mode = "running";
    state.time = 0;
    state.distance = 0;
    state.score = 0;
    state.speed = BASE_SPEED;
    state.spawnTimer = 1.35;
    state.obstacles = [];
    state.particles = [];
    state.night = 0;
    state.milestone = 0;
    state.shake = 0;
    state.speedPulse = 0;
    state.speedTier = 0;
    state.doubleJumpPulse = 0;
    state.lastObstacleType = "tree";
    state.spawnCount = 0;
    player.x = PLAYER_X;
    player.w = STAND_WIDTH;
    player.h = STAND_HEIGHT;
    player.y = GROUND_Y - STAND_HEIGHT;
    player.vy = 0;
    player.grounded = true;
    player.jumpCount = 0;
    player.jumpBuffer = 0;
    player.coyote = 0.12;
    player.ducking = false;
    keys.duck = false;
    gameOverlay.classList.add("is-hidden");
    shareNote.textContent = "";
    stageStatus.textContent = "奔跑中";
    pauseButton.textContent = "暂停";
    updateHud();
    audio.unlock();
    audio.start();
    canvas.focus({ preventScroll: true });
  }

  function endGame(obstacle) {
    if (state.mode !== "running") return;
    state.mode = "gameover";
    state.shake = 13;
    state.runs += 1;
    state.best = Math.max(state.best, state.score);
    storage.set("scut-run-runs", state.runs);
    storage.set("scut-run-best", state.best);
    audio.crash();

    const impactX = clamp(obstacle.x + obstacle.width / 2, 0, GAME_WIDTH);
    const impactY = clamp(obstacle.y + obstacle.height / 2, 0, GROUND_Y);
    makeParticles(impactX, impactY, "#c92f45", 22, 340);
    makeParticles(impactX, impactY, "#f2d98e", 12, 280);

    overlayKicker.textContent = "RUN COMPLETE";
    if (obstacle.type === "bird") {
      overlayTitle.textContent = "撞到喜鹊了";
      overlayCopy.textContent = "低空蓝喜鹊要提前按住向下键，才能从它下面通过。";
    } else if (obstacle.variant === 3) {
      overlayTitle.textContent = "撞上高木棉了";
      overlayCopy.textContent = "高木棉需要连续完成两次跳跃，第二跳要提前一点。";
    } else {
      overlayTitle.textContent = "撞上木棉了";
      overlayCopy.textContent = "木棉树要提前起跳，落地后再看下一组障碍。";
    }
    finalScore.textContent = formatScore(state.score);
    bestScore.textContent = formatScore(state.best);
    overlayResult.hidden = false;
    startButton.textContent = "再跑一轮";
    stageStatus.textContent = "本轮结束";
    gameOverlay.classList.remove("is-hidden");
    updateHud();

    window.dispatchEvent(
      new CustomEvent("scut:run-finished", {
        detail: { score: state.score, best: state.best },
      }),
    );
  }

  function setPaused(paused) {
    if (state.mode === "ready" || state.mode === "gameover") return;
    if (paused && state.mode === "running") {
      state.mode = "paused";
      stageStatus.textContent = "已暂停";
      pauseButton.textContent = "继续";
      return;
    }
    if (!paused && state.mode === "paused") {
      state.mode = "running";
      stageStatus.textContent = "奔跑中";
      pauseButton.textContent = "暂停";
      keys.duck = false;
      duckButton.classList.remove("is-active");
      audio.unlock();
    }
  }

  function togglePause() {
    setPaused(state.mode === "running");
  }

  function updateSoundButton() {
    soundToggle.textContent = state.soundOn ? "音效开" : "音效关";
    soundToggle.setAttribute("aria-pressed", String(state.soundOn));
  }

  async function toggleFullscreen() {
    const stage = document.querySelector(".game-stage");
    if (!document.fullscreenElement) {
      if (stage.requestFullscreen) {
        await stage.requestFullscreen();
      } else if (canvasFrame.requestFullscreen) {
        await canvasFrame.requestFullscreen();
      }
      try {
        await window.screen.orientation?.lock?.("landscape");
      } catch {
        // Browsers may reject orientation locking outside an installed PWA.
      }
    } else {
      await document.exitFullscreen();
    }
  }

  function updateFullscreenButton() {
    fullscreenButton.textContent = document.fullscreenElement ? "退出全屏" : "全屏";
  }

  function update(dt) {
    if (state.mode !== "paused") {
      state.time += dt;
      updateAmbient(dt);
      updateParticles(dt);
      state.shake = Math.max(0, state.shake - dt * 38);
      state.speedPulse = Math.max(0, state.speedPulse - dt * 1.9);
      state.doubleJumpPulse = Math.max(0, state.doubleJumpPulse - dt * 2.7);
    }

    if (state.mode !== "running") return;

    state.distance += state.speed * dt;
    updateSpeed();
    player.ducking = keys.duck;
    updateNight();
    updatePlayer(dt);
    updateScore();
    updateObstacles(dt);
    checkCollisions();

    state.spawnTimer -= dt;
    if (state.spawnTimer <= 0 && state.mode === "running") {
      spawnObstacle();
    }
  }

  let previousTime = performance.now();

  function frame(timestamp) {
    const dt = Math.min(0.033, Math.max(0, (timestamp - previousTime) / 1000));
    previousTime = timestamp;
    update(dt);
    drawScene();
    window.requestAnimationFrame(frame);
  }

  function onKeyDown(event) {
    const tagName = event.target instanceof HTMLElement ? event.target.tagName : "";
    const isFormControl = tagName === "INPUT" || tagName === "TEXTAREA";
    const isButton = tagName === "BUTTON";

    if (isFormControl || (isButton && event.code === "Space")) return;

    if (event.code === "Space" || event.code === "ArrowUp" || event.code === "KeyW") {
      event.preventDefault();
      if (state.mode === "ready" || state.mode === "gameover") {
        startGame();
        return;
      }
      if (state.mode === "paused") {
        setPaused(false);
        return;
      }
      keys.jump = true;
      if (!event.repeat) queueJump();
    }

    if (event.code === "ArrowDown" || event.code === "KeyS") {
      event.preventDefault();
      keys.duck = true;
      duckButton.classList.add("is-active");
    }

    if (event.code === "Escape" || event.code === "KeyP") {
      event.preventDefault();
      togglePause();
    }
  }

  function onKeyUp(event) {
    if (event.code === "Space" || event.code === "ArrowUp" || event.code === "KeyW") {
      keys.jump = false;
      if (!player.grounded && player.vy < -330) {
        player.vy *= 0.56;
      }
    }
    if (event.code === "ArrowDown" || event.code === "KeyS") {
      keys.duck = false;
      duckButton.classList.remove("is-active");
    }
  }

  function pointInCanvas(event) {
    const rect = canvas.getBoundingClientRect();
    return {
      x: ((event.clientX - rect.left) / rect.width) * GAME_WIDTH,
      y: ((event.clientY - rect.top) / rect.height) * GAME_HEIGHT,
    };
  }

  function onCanvasPointerDown(event) {
    if (event.button !== undefined && event.button !== 0) return;
    state.pointer = {
      id: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      movedDown: false,
    };
    canvas.setPointerCapture?.(event.pointerId);
    if (state.mode === "ready" || state.mode === "gameover") {
      startGame();
      return;
    }
    if (state.mode === "paused") {
      setPaused(false);
    }
  }

  function onCanvasPointerMove(event) {
    if (!state.pointer || event.pointerId !== state.pointer.id) return;
    const dx = event.clientX - state.pointer.startX;
    const dy = event.clientY - state.pointer.startY;
    if (dy > 34 && Math.abs(dy) > Math.abs(dx)) {
      state.pointer.movedDown = true;
      keys.duck = true;
      duckButton.classList.add("is-active");
    }
  }

  function onCanvasPointerUp(event) {
    if (!state.pointer || event.pointerId !== state.pointer.id) return;
    const wasDownSwipe = state.pointer.movedDown;
    state.pointer = null;
    keys.duck = false;
    duckButton.classList.remove("is-active");
    if (!wasDownSwipe && (event.pointerType === "mouse" || event.pointerType === "touch")) {
      queueJump();
    }
  }

  async function shareScore() {
    const score = state.mode === "gameover" || state.mode === "running" ? state.score : state.best;
    const shareUrl = new URL(window.location.href);
    shareUrl.searchParams.set("score", String(score));
    const text = `我在“华工快跑”跑到了 ${score} 分，来挑战一下。`;

    try {
      if (navigator.share) {
        await navigator.share({
          title: "华工快跑",
          text,
          url: shareUrl.toString(),
        });
        shareNote.textContent = "战报已分享";
        return;
      }

      await navigator.clipboard.writeText(`${text} ${shareUrl.toString()}`);
      shareNote.textContent = "战报链接已复制";
    } catch (error) {
      if (error && error.name === "AbortError") return;
      shareNote.textContent = "分享不可用，可以直接复制浏览器地址";
    }
  }

  startButton.addEventListener("click", startGame);
  pauseButton.addEventListener("click", togglePause);
  fullscreenButton.addEventListener("click", () => {
    toggleFullscreen().catch(() => {
      stageStatus.textContent = "横屏后画面更大";
    });
  });
  soundToggle.addEventListener("click", () => {
    state.soundOn = !state.soundOn;
    storage.set("scut-run-sound", state.soundOn);
    updateSoundButton();
    if (state.soundOn) {
      audio.unlock();
      audio.point();
    }
  });
  helpButton.addEventListener("click", () => infoDialog.showModal());
  footerHelpButton.addEventListener("click", () => infoDialog.showModal());
  closeDialogButton.addEventListener("click", () => infoDialog.close());
  infoDialog.addEventListener("click", (event) => {
    if (event.target === infoDialog) infoDialog.close();
  });
  shareButton.addEventListener("click", shareScore);

  jumpButton.addEventListener("pointerdown", (event) => {
    event.preventDefault();
    jumpButton.classList.add("is-active");
    if (state.mode === "ready" || state.mode === "gameover") {
      startGame();
    } else {
      queueJump();
    }
  });
  jumpButton.addEventListener("pointerup", () => jumpButton.classList.remove("is-active"));
  jumpButton.addEventListener("pointercancel", () => jumpButton.classList.remove("is-active"));

  const stopDucking = (event) => {
    event.preventDefault();
    keys.duck = false;
    duckButton.classList.remove("is-active");
  };
  duckButton.addEventListener("pointerdown", (event) => {
    event.preventDefault();
    keys.duck = true;
    duckButton.classList.add("is-active");
  });
  duckButton.addEventListener("pointerup", stopDucking);
  duckButton.addEventListener("pointercancel", stopDucking);
  duckButton.addEventListener("pointerleave", (event) => {
    if (event.buttons === 1) stopDucking(event);
  });

  canvas.addEventListener("pointerdown", onCanvasPointerDown);
  canvas.addEventListener("pointermove", onCanvasPointerMove);
  canvas.addEventListener("pointerup", onCanvasPointerUp);
  canvas.addEventListener("pointercancel", (event) => {
    if (state.pointer && event.pointerId === state.pointer.id) {
      state.pointer = null;
      keys.duck = false;
      duckButton.classList.remove("is-active");
    }
  });

  window.addEventListener("keydown", onKeyDown, { passive: false });
  window.addEventListener("keyup", onKeyUp);
  window.addEventListener("blur", () => setPaused(true));
  document.addEventListener("visibilitychange", () => {
    if (document.hidden) setPaused(true);
  });
  window.addEventListener("resize", setupCanvas);
  document.addEventListener("fullscreenchange", updateFullscreenButton);

  if ("serviceWorker" in navigator && window.location.protocol.startsWith("http")) {
    window.addEventListener("load", () => {
      navigator.serviceWorker.register("./service-worker.js").catch(() => {
        // Offline support is an enhancement; the game still works without it.
      });
    });
  }

  setupCanvas();
  createAmbientScene();
  updateSoundButton();
  updateFullscreenButton();
  resetGame();
  const query = new URLSearchParams(window.location.search);
  const qaEnabled = query.has("qa");
  window.__SCUT_RUNNER_TEST__ = {
    getState() {
      return {
        mode: state.mode,
        score: state.score,
        best: state.best,
        runs: state.runs,
        night: state.night,
        speed: state.speed,
        obstacleCount: state.obstacles.length,
        spawnCount: state.spawnCount,
        logoReady: state.logoReady,
        player: {
          x: player.x,
          y: player.y,
          w: player.w,
          h: player.h,
          grounded: player.grounded,
          jumpCount: player.jumpCount,
          ducking: player.ducking,
        },
      };
    },
  };
  if (qaEnabled) {
    window.__SCUT_RUNNER_QA__ = {
      clearObstacles() {
        state.obstacles = [];
        state.spawnTimer = 999;
      },
      spawnRegularObstacles(count = 4) {
        state.obstacles = [];
        state.spawnCount = 0;
        state.lastObstacleType = "tree";
        for (let index = 0; index < count; index += 1) {
          spawnObstacle();
        }
        const lastObstacle = state.obstacles.at(-1);
        return {
          type: lastObstacle.type,
          variant: lastObstacle.variant ?? null,
        };
      },
      spawnBird(distance = 420, y = GROUND_Y - 82) {
        state.obstacles = [];
        state.spawnTimer = 999;
        stageStatus.textContent = "低空蓝喜鹊 · 按住向下键低头";
        state.obstacles.push({
          type: "bird",
          x: player.x + distance,
          y,
          width: 62,
          height: 43,
          hitbox: { x: 9, y: 7, w: 49, h: 32 },
          phase: 0,
          passed: false,
        });
      },
      spawnTallTree(distance = 560) {
        state.obstacles = [];
        state.spawnTimer = 999;
        stageStatus.textContent = "高木棉 · 需要二段跳";
        const template = groundObstacleTemplate(3);
        state.obstacles.push({
          type: "tree",
          variant: 3,
          x: player.x + distance,
          y: GROUND_Y - template.height,
          baseY: GROUND_Y,
          width: template.width,
          height: template.height,
          hitbox: template.hitbox,
          phase: 0,
          passed: false,
        });
      },
    };
  }
  window.requestAnimationFrame(frame);
})();
