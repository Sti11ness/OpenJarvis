const SIZE = 440;
const CENTER = SIZE / 2;
const TURN = Math.PI * 2;
const GOLDEN_ANGLE = Math.PI * (3 - Math.sqrt(5));
const CAMERA = 3.35;
const FOCAL_LENGTH = 550;

const PHASES = {
  starting:     {base: "80,155,203", tip: "203,237,255", speed: .12, fire: .18, wave: .9, spread: .03},
  ready:        {base: "74,160,205", tip: "196,238,255", speed: .15, fire: .25, wave: 1.2, spread: .03},
  listening:    {base: "51,227,198", tip: "184,255,233", speed: .14, fire: .34, wave: 1.8, spread: .05},
  recording:    {base: "51,235,177", tip: "195,255,227", speed: .22, fire: .58, wave: 2.5, spread: .09},
  transcribing: {base: "91,173,255", tip: "207,234,255", speed: .27, fire: .63, wave: 2.9, spread: .05},
  thinking:     {base: "148,115,255", tip: "234,218,255", speed: .43, fire: .81, wave: 4.3, spread: .065},
  speaking:     {base: "255,149,78", tip: "255,226,173", speed: .24, fire: .68, wave: 2.7, spread: .10},
  error:        {base: "226,102,112", tip: "255,205,204", speed: .08, fire: .20, wave: .8, spread: .02},
};

const clamp = (value) => Math.max(0, Math.min(1, value));
const rgba = (color, opacity) => `rgba(${color},${clamp(opacity)})`;
const lerp = (a, b, t) => a + (b - a) * t;
const add = (a, b, amount = 1) => [a[0] + b[0] * amount, a[1] + b[1] * amount, a[2] + b[2] * amount];
const subtract = (a, b) => add(a, b, -1);
const length = ([x, y, z]) => Math.hypot(x, y, z);
const cross = ([x, y, z], [a, b, c]) => [y * c - z * b, z * a - x * c, x * b - y * a];

function unit(vector) {
  const size = length(vector) || 1;
  return vector.map((component) => component / size);
}

function buildNetwork() {
  let seed = 15319;
  const random = () => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    return seed / 4294967296;
  };
  const neurons = [];
  const shells = [[41, .83, 1.0], [24, .47, .77], [12, .10, .44]];

  for (const [shell, [count, min, max]] of shells.entries()) {
    const offset = random() * TURN;
    for (let index = 0; index < count; index += 1) {
      const y = 1 - 2 * (index + .5) / count;
      const horizontal = Math.sqrt(1 - y * y);
      const angle = offset + index * GOLDEN_ANGLE + (random() - .5) * .21;
      const radius = lerp(min, max, random());
      const position = [
        Math.cos(angle) * horizontal * radius,
        y * radius,
        Math.sin(angle) * horizontal * radius,
      ];
      const major = shell === 2 || index % (shell === 1 ? 3 : 4) === 0;
      const branches = [];
      if (major) {
        const normal = unit(position);
        const right = unit(cross(normal, Math.abs(normal[1]) > .8 ? [1, 0, 0] : [0, 1, 0]));
        const up = cross(normal, right);
        for (let root = 0; root < 4; root += 1) {
          const direction = angle + root * TURN / 4 + (random() - .5) * .55;
          const tangent = add(right.map((value) => value * Math.cos(direction)), up, Math.sin(direction));
          const side = cross(normal, tangent);
          const elbow = add(tangent.map((value) => value * (.055 + random() * .04)), normal, -.015);
          branches.push({
            elbow,
            left: add(add(elbow, tangent, .065), side, .04),
            right: add(add(elbow, tangent, .045), side, -.055),
          });
        }
      }
      neurons.push({
        index: neurons.length, position, shell, radius, major, branches,
        size: major ? 2.5 + random() * 2.4 : 1 + random() * 1.6,
        phase: random() * TURN, world: [0, 0, 0], screen: {}, firing: 0,
      });
    }
  }

  const links = [];
  const joined = new Set();
  function connect(from, to) {
    const key = `${Math.min(from.index, to.index)}:${Math.max(from.index, to.index)}`;
    if (joined.has(key)) return;
    joined.add(key);
    const chord = subtract(to.position, from.position);
    const normal = unit(cross(chord, Math.abs(chord[1]) > .35 ? [1, 0, 0] : [0, 1, 0]));
    const curve = (random() - .5) * Math.min(.27, length(chord) * .42);
    links.push({
      from, to, bend: normal.map((value) => value * curve),
      offset: random(), rate: .66 + random() * .74, first: {}, second: {}, depth: 0,
    });
  }

  for (const from of neurons) {
    const nearby = neurons
      .filter((other) => other !== from)
      .map((other) => ({other, distance: length(subtract(other.position, from.position))}))
      .sort((a, b) => a.distance - b.distance);
    for (const {other} of nearby.slice(0, from.shell === 0 ? 2 : 3)) connect(from, other);
    if (from.major) {
      const inward = nearby.find(({other}) => other.shell > from.shell);
      if (inward) connect(from, inward.other);
    }
  }
  return {neurons, links};
}

function bezier(start, first, second, end, progress) {
  const rest = 1 - progress;
  return rest ** 3 * start + 3 * rest ** 2 * progress * first
    + 3 * rest * progress ** 2 * second + progress ** 3 * end;
}

export function mountNeuralActivity(canvas) {
  const ctx = canvas.getContext("2d");
  if (!ctx) return {update() {}, dispose() {}};

  const motion = window.matchMedia("(prefers-reduced-motion: reduce)");
  const {neurons, links} = buildNetwork();
  const orderedNeurons = [...neurons];
  const sprites = new Map();
  const branchPoint = {};
  let phase = "starting";
  let level = 0;
  let signal = 0;
  let yaw = .55;
  let pitch = -.23;
  let sinYaw = 0;
  let cosYaw = 1;
  let sinPitch = 0;
  let cosPitch = 1;
  let time = 0;
  let waveTime = 1.1;
  let flow = .24;
  let lastFrame = 0;
  let animation = 0;
  let disposed = false;

  function project(x, y, z, target) {
    const side = x * cosYaw + z * sinYaw;
    const depth = z * cosYaw - x * sinYaw;
    const up = y * cosPitch - depth * sinPitch;
    const viewZ = y * sinPitch + depth * cosPitch;
    const perspective = FOCAL_LENGTH / (CAMERA - viewZ);
    target.x = CENTER + side * perspective;
    target.y = CENTER - up * perspective;
    target.z = viewZ;
    target.scale = perspective / (FOCAL_LENGTH / CAMERA);
    target.near = clamp((viewZ + 1.15) / 2.3);
  }

  function dot(x, y, radius, color, opacity) {
    ctx.beginPath();
    ctx.arc(x, y, radius, 0, TURN);
    ctx.fillStyle = rgba(color, opacity);
    ctx.fill();
  }

  function halo(x, y, radius, color, opacity) {
    let sprite = sprites.get(color);
    if (!sprite) {
      sprite = document.createElement("canvas");
      sprite.width = sprite.height = 96;
      const brush = sprite.getContext("2d");
      const gradient = brush.createRadialGradient(48, 48, 0, 48, 48, 48);
      gradient.addColorStop(0, rgba(color, 1));
      gradient.addColorStop(.28, rgba(color, .36));
      gradient.addColorStop(.63, rgba(color, .08));
      gradient.addColorStop(1, rgba(color, 0));
      brush.fillStyle = gradient;
      brush.fillRect(0, 0, 96, 96);
      sprites.set(color, sprite);
    }
    ctx.globalAlpha = clamp(opacity);
    ctx.drawImage(sprite, x - radius, y - radius, radius * 2, radius * 2);
    ctx.globalAlpha = 1;
  }

  function placeNeurons(style, drive, reduced) {
    for (const node of neurons) {
      const [x, y, z] = node.position;
      const travel = phase === "recording" ? y * 2.8 : node.radius * 5;
      const wave = .5 + .5 * Math.sin(waveTime - travel + node.phase * .18);
      const pulse = reduced ? 1 : 1 + wave * (style.spread + drive * .105);
      const sway = reduced ? 0 : .009 + drive * .018;
      node.world[0] = x * pulse + sway * Math.cos(time * 1.37 + node.phase);
      node.world[1] = y * pulse + sway * Math.sin(time * 1.23 + node.phase);
      node.world[2] = z * pulse + sway * Math.sin(time * 1.09 + node.phase);
      project(...node.world, node.screen);
      node.firing = wave * drive * .28;
    }
    orderedNeurons.sort((a, b) => a.screen.z - b.screen.z);
    for (const link of links) link.depth = (link.from.screen.z + link.to.screen.z) * .5;
    links.sort((a, b) => a.depth - b.depth);
  }

  function drawLink(link, style, power) {
    const {from, to, bend, first, second} = link;
    const start = from.screen;
    const end = to.screen;
    const [x, y, z] = from.world;
    const [ex, ey, ez] = to.world;
    project(lerp(x, ex, .31) + bend[0], lerp(y, ey, .31) + bend[1],
      lerp(z, ez, .31) + bend[2], first);
    project(lerp(x, ex, .68) - bend[0] * .62, lerp(y, ey, .68) - bend[1] * .62,
      lerp(z, ez, .68) - bend[2] * .62, second);
    const near = (start.near + end.near) * .5;

    ctx.beginPath();
    ctx.moveTo(start.x, start.y);
    ctx.bezierCurveTo(first.x, first.y, second.x, second.y, end.x, end.y);
    ctx.lineWidth = .45 + near * .8;
    ctx.strokeStyle = rgba(style.base, .065 + near * .25 + power * .10);
    ctx.stroke();

    const cycle = (flow * link.rate + link.offset) % 1;
    const activeSpan = .18 + power * .52;
    if (cycle >= activeSpan) return;

    const front = cycle / activeSpan;
    const tail = Math.max(0, front - .10 - power * .13);
    const brightness = Math.sin(front * Math.PI) * (.18 + near * .53 + power * .29);
    if (front > .82) to.firing = Math.max(to.firing, brightness * 2);
    if (front < .17) from.firing = Math.max(from.firing, brightness * 1.35);

    ctx.beginPath();
    let headX = 0;
    let headY = 0;
    for (let sample = 0; sample <= 5; sample += 1) {
      const progress = lerp(tail, front, sample / 5);
      headX = bezier(start.x, first.x, second.x, end.x, progress);
      headY = bezier(start.y, first.y, second.y, end.y, progress);
      if (sample === 0) ctx.moveTo(headX, headY);
      else ctx.lineTo(headX, headY);
    }
    ctx.lineWidth = 3.5 + near * 2.2;
    ctx.strokeStyle = rgba(style.base, brightness * .24);
    ctx.stroke();
    ctx.lineWidth = .85 + near * 1.25;
    ctx.strokeStyle = rgba(style.tip, brightness);
    ctx.stroke();
    dot(headX, headY, .8 + near * 1.1, style.tip, brightness * 1.2);
  }

  function drawNeuron(node, style, power) {
    const {x, y, near, scale} = node.screen;
    const firing = clamp(node.firing);
    const size = node.size * scale * (1 + firing * .44);
    if (node.major) {
      ctx.beginPath();
      for (const {elbow, left, right} of node.branches) {
        const [nx, ny, nz] = node.world;
        project(nx + elbow[0], ny + elbow[1], nz + elbow[2], branchPoint);
        const elbowX = branchPoint.x;
        const elbowY = branchPoint.y;
        ctx.moveTo(x, y);
        ctx.lineTo(elbowX, elbowY);
        for (const end of [left, right]) {
          project(nx + end[0], ny + end[1], nz + end[2], branchPoint);
          ctx.moveTo(elbowX, elbowY);
          ctx.lineTo(branchPoint.x, branchPoint.y);
        }
      }
      ctx.lineWidth = .55 + near * .65;
      ctx.strokeStyle = rgba(style.base, .08 + near * .33 + firing * .26);
      ctx.stroke();
      halo(x, y, size * 4, style.base, .12 + near * .21 + firing * .37);
    }
    dot(x, y, size, style.base, .19 + near * .48 + firing * .27);
    if (node.major || firing > .30) {
      dot(x, y, size * .46, style.tip, .24 + near * .50 + firing * .24 + power * .06);
    }
  }

  function draw(delta) {
    const style = PHASES[phase] || PHASES.ready;
    const reduced = motion.matches;
    signal += (level - signal) * (reduced ? 1 : level > signal ? .54 : .19);
    const drive = Math.sqrt(signal);
    const power = clamp(style.fire + drive * .63);
    if (!reduced && delta > 0) {
      time += delta;
      yaw += delta * (style.speed + drive * .21);
      pitch = -.23 + Math.sin(time * .54) * (.22 + drive * .19);
      flow += delta * (.30 + style.fire * .78 + drive * 1.42);
      waveTime += delta * (style.wave + drive * 6.4);
    }
    const viewYaw = reduced ? .55 : yaw;
    const viewPitch = reduced ? -.23 : pitch;
    sinYaw = Math.sin(viewYaw);
    cosYaw = Math.cos(viewYaw);
    sinPitch = Math.sin(viewPitch);
    cosPitch = Math.cos(viewPitch);

    const scale = Math.min(canvas.width, canvas.height) / SIZE;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.setTransform(scale, 0, 0, scale,
      (canvas.width - SIZE * scale) * .5, (canvas.height - SIZE * scale) * .5);
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    halo(CENTER, CENTER, 218, style.base, .15 + power * .15);
    halo(CENTER - 40, CENTER - 25, 112, style.base, .08 + power * .13);

    placeNeurons(style, drive, reduced);
    // Paint rear nodes first so foreground axons and cell bodies retain their depth.
    let nextNode = 0;
    for (const link of links) {
      while (nextNode < orderedNeurons.length && orderedNeurons[nextNode].screen.z < link.depth) {
        drawNeuron(orderedNeurons[nextNode++], style, power);
      }
      drawLink(link, style, power);
    }
    while (nextNode < orderedNeurons.length) drawNeuron(orderedNeurons[nextNode++], style, power);
  }

  function tick(now) {
    animation = 0;
    if (disposed || document.hidden || motion.matches) return;
    const interval = phase === "speaking" || phase === "recording" ? 30 : 40;
    if (now - lastFrame >= interval) {
      draw(Math.min(.08, (now - lastFrame) / 1000));
      lastFrame = now;
    }
    animation = requestAnimationFrame(tick);
  }

  function refresh() {
    if (animation) cancelAnimationFrame(animation);
    animation = 0;
    if (disposed) return;
    lastFrame = performance.now();
    draw(0);
    if (!motion.matches && !document.hidden) animation = requestAnimationFrame(tick);
  }

  function resize() {
    if (disposed) return;
    const bounds = canvas.getBoundingClientRect();
    if (bounds.width < 1 || bounds.height < 1) return;
    const ratio = Math.min(2, window.devicePixelRatio || 1);
    const width = Math.round(bounds.width * ratio);
    const height = Math.round(bounds.height * ratio);
    if (canvas.width !== width || canvas.height !== height) {
      canvas.width = width;
      canvas.height = height;
    }
    draw(0);
  }

  const observer = new ResizeObserver(resize);
  observer.observe(canvas);
  document.addEventListener("visibilitychange", refresh);
  motion.addEventListener("change", refresh);
  resize();
  refresh();

  return {
    update(nextPhase, nextLevel) {
      if (disposed) return;
      const next = clamp(Number(nextLevel) || 0);
      if (phase === nextPhase && level === next) return;
      phase = nextPhase;
      level = next;
      if (motion.matches) draw(0);
    },
    dispose() {
      disposed = true;
      if (animation) cancelAnimationFrame(animation);
      observer.disconnect();
      document.removeEventListener("visibilitychange", refresh);
      motion.removeEventListener("change", refresh);
    },
  };
}
