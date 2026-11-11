export function mountNeuralActivity(canvas) {
  const ctx = canvas.getContext("2d");
  if (!ctx) return {update() {}, dispose() {}};

  const motion = window.matchMedia("(prefers-reduced-motion: reduce)");
  const size = 440;
  const tau = Math.PI * 2;
  const palettes = {
    starting:     {base: "87,145,180", light: "178,223,246", activity: .16, pace: .23},
    ready:        {base: "79,166,199", light: "187,236,249", activity: .28, pace: .29},
    listening:    {base: "68,216,198", light: "171,255,238", activity: .46, pace: .48},
    recording:    {base: "72,241,205", light: "199,255,240", activity: .71, pace: .73},
    transcribing: {base: "93,183,249", light: "194,232,255", activity: .56, pace: .60},
    thinking:     {base: "121,146,255", light: "219,219,255", activity: .65, pace: .85},
    speaking:     {base: "248,159,85", light: "255,227,180", activity: .69, pace: .66},
    error:        {base: "207,125,108", light: "244,189,171", activity: .25, pace: .24},
  };

  let seed = 15319;
  const random = () => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    return seed / 4294967296;
  };
  const rgba = (color, alpha) => `rgba(${color},${alpha})`;
  const clamp = (value) => Math.max(0, Math.min(1, value));

  // Layered clusters around the main cell, with no enclosing contour or axis of rotation.
  const layout = [
    [209, 216,  1.0, 15, 105, 8],
    [306, 136,   .7, 10,  77, 7],
    [125, 306,   .8, 11,  70, 7],
    [104, 130,   .2,  9,  65, 6],
    [313, 302,   .1,  8,  60, 6],
    [221,  87,  -.5,  5,  47, 5],
    [ 72, 227,  -.4,  5,  47, 5],
    [366, 220,  -.3,  5,  51, 5],
    [234, 362,  -.4,  5,  49, 5],
    [340,  77,  -.8,  3,  38, 4],
    [ 66,  79,  -.8,  3,  35, 4],
    [375, 336,  -.7,  3,  39, 4],
    [100, 369,  -.8,  3,  38, 4],
  ];

  function makeNeuron([x, y, depth, radius, reach, roots]) {
    const tiers = [[], [], []];
    const tips = [];
    const membrane = [];
    const offset = random() * tau;

    function fork(x, y, angle, length, tier) {
      const toX = x + Math.cos(angle) * length;
      const toY = y + Math.sin(angle) * length;
      const bend = (random() - .5) * length * .52;
      tiers[tier].push([
        x, y,
        (x + toX) / 2 + Math.sin(angle) * bend,
        (y + toY) / 2 - Math.cos(angle) * bend,
        toX, toY,
      ]);
      if (tier < (radius > 5 ? 2 : 1)) {
        const spread = .25 + random() * .40;
        fork(toX, toY, angle - spread, length * (.45 + random() * .25), tier + 1);
        fork(toX, toY, angle + spread, length * (.38 + random() * .29), tier + 1);
      } else if (random() < .55) {
        tips.push([toX, toY, random()]);
      }
    }

    for (let root = 0; root < roots; root += 1) {
      const angle = offset + root * tau / roots + (random() - .5) * .39;
      const start = radius * .54;
      membrane.push(
        [angle, radius * (1.06 + random() * .55)],
        [angle + tau / roots * .44, radius * (.47 + random() * .28)],
      );
      fork(Math.cos(angle) * start, Math.sin(angle) * start,
        angle + (random() - .5) * .44, reach * (.39 + random() * .26), 0);
    }

    return {x, y, depth, radius, tiers, tips, membrane, offset, firing: 0, dx: 0, dy: 0, bend: 0};
  }

  const neurons = layout.map(makeNeuron);
  const layered = [...neurons].sort((left, right) => left.depth - right.depth);
  const links = [
    [0, 1, -24], [1, 5, 20], [5, 3, -18], [3, 0, 24], [0, 2, -19],
    [2, 6, 18], [6, 3, -16], [0, 4, 19], [4, 7, -23], [7, 1, 18],
    [2, 8, -19], [8, 4, 17], [1, 9, -12], [3, 10, -17], [4, 11, 14],
    [2, 12, 10], [5, 0, 25], [6, 0, -22], [7, 0, 27], [8, 0, -19],
  ].map(([source, target, bend]) => ({
    from: neurons[source],
    to: neurons[target],
    bend,
    offset: random(),
    rate: .75 + random() * .54,
    depth: (neurons[source].depth + neurons[target].depth) / 2,
  })).sort((left, right) => left.depth - right.depth);
  const dust = Array.from({length: 80}, () => ({
    x: 35 + random() * 370,
    y: 30 + random() * 380,
    radius: .25 + random() * .75,
    phase: random() * tau,
  }));

  let phase = "starting";
  let level = 0;
  let signal = 0;
  let lastFrame = 0;
  let flow = .31;
  let animation = 0;

  function dot(x, y, radius, color, alpha) {
    ctx.beginPath();
    ctx.arc(x, y, radius, 0, tau);
    ctx.fillStyle = rgba(color, alpha);
    ctx.fill();
  }

  function halo(x, y, radius, color, strength) {
    const glow = ctx.createRadialGradient(x, y, 0, x, y, radius);
    glow.addColorStop(0, rgba(color, strength));
    glow.addColorStop(.33, rgba(color, strength * .44));
    glow.addColorStop(1, rgba(color, 0));
    ctx.fillStyle = glow;
    ctx.fillRect(x - radius, y - radius, radius * 2, radius * 2);
  }

  function drawBackground(time, palette, power) {
    halo(207, 215, 180, palette.base, .04 + power * .09);
    halo(300, 146, 111, palette.base, .035 + power * .04);
    halo(126, 307, 105, palette.base, .035 + power * .035);

    for (const point of dust) {
      const drift = Math.sin(time * .64 + point.phase);
      dot(point.x + drift * 2, point.y, point.radius, palette.base, .055 + (drift + 1) * .06);
    }
  }

  function moveNeurons(time, movement) {
    for (const node of neurons) {
      const breath = Math.sin(time * 1.11 + node.offset);
      const sway = Math.cos(time * .83 + node.offset);
      const parallax = .78 + node.depth * .24;
      const spread = movement * (1 + .65 * breath);
      node.dx = node.x + breath * (2 + movement * 6) * parallax + (node.x - 209) * spread * .075;
      node.dy = node.y + sway * (2 + movement * 5) * parallax + (node.y - 216) * spread * .075;
      node.bend = sway * (.032 + movement * .10);
      node.firing = 0;
    }
  }

  function cubic(start, first, second, end, progress) {
    const inv = 1 - progress;
    return inv ** 3 * start + 3 * inv ** 2 * progress * first
      + 3 * inv * progress ** 2 * second + progress ** 3 * end;
  }

  function drawAxon(link, palette, power) {
    const {from, to, depth} = link;
    const x = to.dx - from.dx;
    const y = to.dy - from.dy;
    const length = Math.hypot(x, y);
    const normalX = -y / length;
    const normalY = x / length;
    const bend = link.bend * (1 + (from.bend - to.bend) * 1.6);
    const firstX = from.dx + x * .23 + normalX * bend;
    const firstY = from.dy + y * .23 + normalY * bend;
    const secondX = from.dx + x * .66 - normalX * bend * .56;
    const secondY = from.dy + y * .66 - normalY * bend * .56;
    const foreground = depth > .15;

    ctx.beginPath();
    ctx.moveTo(from.dx, from.dy);
    ctx.bezierCurveTo(firstX, firstY, secondX, secondY, to.dx, to.dy);
    ctx.lineWidth = foreground ? 4.8 : 3.1;
    ctx.strokeStyle = rgba(palette.base, .028 + power * .083);
    ctx.stroke();
    ctx.lineWidth = foreground ? 1.24 : .75;
    ctx.strokeStyle = rgba(palette.base, .25 + power * .15 + depth * .11);
    ctx.stroke();

    const cycle = (flow * link.rate + link.offset) % 1;
    const pulseSpan = .36 + power * .35;
    if (cycle >= pulseSpan) return;
    const head = cycle / pulseSpan;
    const strength = Math.sin(Math.PI * head) * (.48 + power * .52);
    const tail = Math.max(0, head - .17 - power * .11);
    if (head > .78) to.firing = Math.max(to.firing, strength * 1.7);
    if (head < .22) from.firing = Math.max(from.firing, strength);

    ctx.beginPath();
    for (let index = 0; index <= 6; index += 1) {
      const progress = tail + (head - tail) * index / 6;
      const px = cubic(from.dx, firstX, secondX, to.dx, progress);
      const py = cubic(from.dy, firstY, secondY, to.dy, progress);
      if (index === 0) ctx.moveTo(px, py);
      else ctx.lineTo(px, py);
    }
    ctx.lineWidth = 5 + power * 3;
    ctx.strokeStyle = rgba(palette.base, strength * .16);
    ctx.stroke();
    ctx.lineWidth = 1.1 + power * 1.4;
    ctx.strokeStyle = rgba(palette.light, strength * .93);
    ctx.stroke();

    const headX = cubic(from.dx, firstX, secondX, to.dx, head);
    const headY = cubic(from.dy, firstY, secondY, to.dy, head);
    dot(headX, headY, 1.2 + power * 1.7, palette.light, strength);
  }

  function drawDendrites(node, palette, power) {
    const depth = (node.depth + 1) / 2;
    ctx.save();
    ctx.translate(node.dx, node.dy);
    ctx.rotate(node.bend);

    for (const [tier, branches] of node.tiers.entries()) {
      ctx.beginPath();
      for (const [x, y, bendX, bendY, toX, toY] of branches) {
        ctx.moveTo(x, y);
        ctx.quadraticCurveTo(bendX, bendY, toX, toY);
      }
      ctx.lineWidth = (2.1 - tier * .62) * (.66 + depth * .34);
      ctx.strokeStyle = rgba(palette.base, (.23 + depth * .20 + power * .14 + node.firing * .23) / (1 + tier * .37));
      ctx.stroke();
    }

    for (const [x, y, brightness] of node.tips) {
      dot(x, y, .38 + brightness * .79, palette.light, .10 + depth * .18 + power * .15);
    }
    ctx.restore();
  }

  function drawSoma(node, time, palette, power) {
    const depth = (node.depth + 1) / 2;
    const pulse = node.firing * .67 + power * (.23 + .18 * Math.sin(time * 2.6 + node.offset));
    const stretch = motion.matches ? 1 : 1 + pulse * .25;
    const radius = node.radius * stretch;
    if (node.radius >= 8) halo(node.dx, node.dy, radius * 3.6, palette.base, .09 + pulse * .34);

    const points = node.membrane.map(([angle, distance]) => [
      node.dx + Math.cos(angle + node.bend) * distance * stretch,
      node.dy + Math.sin(angle + node.bend) * distance * stretch,
    ]);
    const last = points.at(-1);
    ctx.beginPath();
    ctx.moveTo((last[0] + points[0][0]) / 2, (last[1] + points[0][1]) / 2);
    for (let index = 0; index < points.length; index += 1) {
      const point = points[index];
      const next = points[(index + 1) % points.length];
      ctx.quadraticCurveTo(point[0], point[1], (point[0] + next[0]) / 2, (point[1] + next[1]) / 2);
    }
    ctx.closePath();

    const interior = ctx.createRadialGradient(node.dx - radius * .20, node.dy - radius * .23, 0,
      node.dx, node.dy, radius * 1.16);
    interior.addColorStop(0, rgba(palette.light, .52 + pulse * .42));
    interior.addColorStop(.37, rgba(palette.base, .72 + pulse * .17));
    interior.addColorStop(1, rgba(palette.base, .16));
    ctx.fillStyle = interior;
    ctx.fill();
    ctx.lineWidth = .66 + depth * .61;
    ctx.strokeStyle = rgba(palette.light, .27 + depth * .24 + pulse * .30);
    ctx.stroke();
    dot(node.dx - radius * .18, node.dy - radius * .18, Math.max(.65, radius * .18),
      palette.light, .33 + depth * .27 + pulse * .31);
  }

  function draw(now, elapsed) {
    const palette = palettes[phase] || palettes.ready;
    const reduced = motion.matches;
    const time = reduced ? 2.4 : now / 1000;
    signal += (level - signal) * (reduced ? 1 : level > signal ? .42 : .15);
    const power = clamp(palette.activity + signal * .67);
    if (!reduced) flow += elapsed * (palette.pace + signal * 1.34);

    const scale = canvas.width / size;
    ctx.setTransform(scale, 0, 0, scale, 0, 0);
    ctx.clearRect(0, 0, size, size);
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    drawBackground(time, palette, power);
    moveNeurons(time, reduced ? 0 : signal);
    for (const link of links) drawAxon(link, palette, power);
    for (const node of layered) drawDendrites(node, palette, power);
    for (const node of layered) drawSoma(node, time, palette, power);
  }

  function tick(now) {
    animation = 0;
    const interval = phase === "recording" || phase === "speaking" || level > .04 ? 30 : 46;
    if (!document.hidden && now - lastFrame >= interval) {
      draw(now, Math.min(.08, (now - lastFrame) / 1000));
      lastFrame = now;
    }
    if (!motion.matches && !document.hidden) animation = requestAnimationFrame(tick);
  }

  function refreshMotion() {
    if (animation) cancelAnimationFrame(animation);
    animation = 0;
    lastFrame = performance.now();
    draw(lastFrame, 0);
    if (!motion.matches && !document.hidden) animation = requestAnimationFrame(tick);
  }

  function resize() {
    const ratio = Math.min(2, window.devicePixelRatio || 1);
    const pixels = Math.max(1, Math.round(canvas.getBoundingClientRect().width * ratio));
    if (canvas.width !== pixels) {
      canvas.width = pixels;
      canvas.height = pixels;
    }
    draw(performance.now(), 0);
  }

  const observer = new ResizeObserver(resize);
  observer.observe(canvas);
  document.addEventListener("visibilitychange", refreshMotion);
  motion.addEventListener("change", refreshMotion);
  refreshMotion();
  return {
    dispose() {
      if (animation) cancelAnimationFrame(animation);
      observer.disconnect();
      document.removeEventListener("visibilitychange", refreshMotion);
      motion.removeEventListener("change", refreshMotion);
    },
    update(nextPhase, nextLevel) {
      const next = clamp(Number(nextLevel) || 0);
      if (phase === nextPhase && level === next) return;
      phase = nextPhase;
      level = next;
      if (motion.matches) draw(performance.now(), 0);
    },
  };
}
