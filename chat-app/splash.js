// ─── Three.js Splash Screen ───────────────────────────────────────────────────
(function () {
  const canvas = document.getElementById('splash-canvas');
  const progressFill = document.getElementById('progress-fill');
  const loadingText = document.getElementById('loading-text');

  const steps = [
    'جاري التحميل...',
    'تهيئة محرك الذكاء الاصطناعي...',
    'تحميل معالج المستندات...',
    'الاتصال بـ Ollama...',
    'مرحباً بك! 🎉',
  ];
  let stepIdx = 0;
  const stepDuration = 800;

  const stepInterval = setInterval(() => {
    stepIdx++;
    if (stepIdx < steps.length) {
      loadingText.textContent = steps[stepIdx];
    } else {
      clearInterval(stepInterval);
    }
  }, stepDuration);

  // Progress bar animation
  let progress = 0;
  const totalDuration = 4000;
  const startTime = performance.now();

  function updateProgress(now) {
    const elapsed = now - startTime;
    progress = Math.min(elapsed / totalDuration, 1);
    progressFill.style.width = (progress * 100) + '%';

    if (progress < 1) {
      requestAnimationFrame(updateProgress);
    } else {
      // Splash done
      setTimeout(() => {
        document.dispatchEvent(new CustomEvent('splashComplete'));
      }, 400);
    }
  }
  requestAnimationFrame(updateProgress);

  // ── Three.js Scene ──────────────────────────────────────────────────────────
  if (typeof THREE === 'undefined') return;

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(60, window.innerWidth / window.innerHeight, 0.1, 1000);
  camera.position.z = 5;

  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.setPixelRatio(window.devicePixelRatio);
  renderer.setClearColor(0x000000, 0);

  // Particles
  const particleCount = 3500;
  const positions = new Float32Array(particleCount * 3);
  const colors = new Float32Array(particleCount * 3);
  for (let i = 0; i < particleCount; i++) {
    const r = 3 + Math.random() * 2;
    const theta = Math.random() * Math.PI * 2;
    const phi = Math.acos(2 * Math.random() - 1);
    positions[i * 3] = r * Math.sin(phi) * Math.cos(theta);
    positions[i * 3 + 1] = r * Math.sin(phi) * Math.sin(theta);
    positions[i * 3 + 2] = r * Math.cos(phi);
    const t = Math.random();
    colors[i * 3] = 0.4 + t * 0.4;
    colors[i * 3 + 1] = 0.3 + t * 0.3;
    colors[i * 3 + 2] = 1.0;
  }
  const particleGeo = new THREE.BufferGeometry();
  particleGeo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  particleGeo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  const particleMat = new THREE.PointsMaterial({ size: 0.025, vertexColors: true, transparent: true, opacity: 0.85 });
  const particles = new THREE.Points(particleGeo, particleMat);
  scene.add(particles);

  // Central icosahedron
  const icoGeo = new THREE.IcosahedronGeometry(0.7, 1);
  const icoMat = new THREE.MeshBasicMaterial({ color: 0x6c63ff, wireframe: true });
  const ico = new THREE.Mesh(icoGeo, icoMat);
  scene.add(ico);

  // Inner solid icosahedron (glowing)
  const icoSolidMat = new THREE.MeshBasicMaterial({ color: 0x4f46e5, transparent: true, opacity: 0.3 });
  const icoSolid = new THREE.Mesh(new THREE.IcosahedronGeometry(0.65, 1), icoSolidMat);
  scene.add(icoSolid);

  // Rings
  function makeRing(radius, color, tilt) {
    const geo = new THREE.TorusGeometry(radius, 0.008, 6, 80);
    const mat = new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.5 });
    const torus = new THREE.Mesh(geo, mat);
    torus.rotation.x = tilt;
    return torus;
  }
  const ring1 = makeRing(1.5, 0x6c63ff, Math.PI / 2);
  const ring2 = makeRing(1.9, 0x00d4aa, Math.PI / 3);
  const ring3 = makeRing(2.3, 0xa855f7, Math.PI / 6);
  scene.add(ring1, ring2, ring3);

  // Animation
  let frame = 0;
  function animate() {
    requestAnimationFrame(animate);
    frame++;
    const t = frame * 0.005;

    particles.rotation.y = t * 0.3;
    particles.rotation.x = t * 0.1;

    ico.rotation.x = t;
    ico.rotation.y = t * 0.7;
    icoSolid.rotation.x = t;
    icoSolid.rotation.y = t * 0.7;

    ring1.rotation.z = t * 0.5;
    ring2.rotation.z = -t * 0.3;
    ring3.rotation.y = t * 0.4;

    // Pulse effect
    const scale = 1 + 0.05 * Math.sin(t * 2);
    ico.scale.setScalar(scale);
    icoSolid.scale.setScalar(scale);

    renderer.render(scene, camera);
  }
  animate();

  window.addEventListener('resize', () => {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
  });
})();
