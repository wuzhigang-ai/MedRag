/* ============================================================
   MedASR — 3D Knowledge Graph (Three.js)
   Loaded as type="module" — exposes Graph3D on window
   ============================================================ */

import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

const PALETTE = [
    '#3b82f6', '#f59e0b', '#10b981', '#ef4444',
    '#8b5cf6', '#ec4899', '#06b6d4', '#f97316',
    '#84cc16', '#6366f1'
];
const FALLBACK_COLOR = '#6b7280';

const PHYSICS = {
    coulombStrength: 300,
    springStrength: 0.008,
    springRestLength: 2.0,
    damping: 0.92,
    centerGravity: 0.002,
    maxInfluenceDist: 8.0,
    maxVelocity: 0.5,
    timeStep: 0.016
};

class Graph3D {
    constructor(container) {
        this.container = container;
        this.nodeMeshes = new Map();
        this.edgeLines = [];
        this.velocities = new Map();
        this._paused = false;
        this._disabled = false;
        this._groupColors = {};
        this._lastTime = performance.now();

        if (!this._checkWebGL()) {
            container.innerHTML = '<div class="graph-fallback">您的浏览器不支持 WebGL，无法显示 3D 知识图谱</div>';
            this._disabled = true;
            return;
        }

        this._initScene();
        this._startLoop();
    }

    _checkWebGL() {
        try {
            var c = document.createElement('canvas');
            return !!(window.WebGLRenderingContext &&
                (c.getContext('webgl') || c.getContext('experimental-webgl')));
        } catch (e) { return false; }
    }

    _initScene() {
        this.scene = new THREE.Scene();
        this.scene.background = new THREE.Color(0x0a0a0f);

        var w = this.container.clientWidth || 800;
        var h = this.container.clientHeight || 600;
        this.camera = new THREE.PerspectiveCamera(55, w / h, 0.5, 100);
        this.camera.position.set(6, 4, 10);
        this.camera.lookAt(0, 0, 0);

        this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
        this.renderer.setSize(w, h);
        this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
        this.container.appendChild(this.renderer.domElement);

        this.scene.add(new THREE.AmbientLight(0x404060, 1.5));
        var dir = new THREE.DirectionalLight(0xffffff, 0.8);
        dir.position.set(10, 20, 10);
        this.scene.add(dir);

        this.controls = new OrbitControls(this.camera, this.renderer.domElement);
        this.controls.enableDamping = true;
        this.controls.dampingFactor = 0.08;
        this.controls.minDistance = 2;
        this.controls.maxDistance = 30;

        var self = this;
        this.renderer.domElement.addEventListener('webglcontextlost', function (e) {
            e.preventDefault();
            self._paused = true;
        });
        this.renderer.domElement.addEventListener('webglcontextrestored', function () {
            self._paused = false;
        });

        this._resizeObserver = new ResizeObserver(function () { self._onResize(); });
        this._resizeObserver.observe(this.container);
    }

    _onResize() {
        var w = this.container.clientWidth;
        var h = this.container.clientHeight;
        if (w > 0 && h > 0) {
            this.camera.aspect = w / h;
            this.camera.updateProjectionMatrix();
            this.renderer.setSize(w, h);
        }
    }

    loadGraph(data) {
        if (this._disabled) return;
        this._clearGraph();

        var nodes = data.nodes || [];
        var edges = data.edges || [];
        var groups = data.groups || [];

        var self = this;
        groups.forEach(function (g, i) {
            self._groupColors[g] = PALETTE[i % PALETTE.length];
        });

        var sharedGeo = new THREE.SphereGeometry(0.12, 16, 12);

        nodes.forEach(function (n) {
            var r = Math.max(0.05, 0.05 + 0.03 * Math.log((n.weight || 1) + 1));
            var geo = r !== 0.12 ? new THREE.SphereGeometry(r, 16, 12) : sharedGeo;
            var colorHex = self._groupColors[n.group] || FALLBACK_COLOR;
            var mat = new THREE.MeshPhongMaterial({
                color: new THREE.Color(colorHex),
                emissive: new THREE.Color(colorHex),
                emissiveIntensity: 0.3,
                specular: 0x222222,
                shininess: 20
            });
            var mesh = new THREE.Mesh(geo, mat);
            mesh.position.set(
                (Math.random() - 0.5) * 4,
                (Math.random() - 0.5) * 4,
                (Math.random() - 0.5) * 4
            );
            mesh.userData = { entityName: n.id, group: n.group, weight: n.weight };
            self.scene.add(mesh);
            self.nodeMeshes.set(n.id, mesh);
            self.velocities.set(n.id, { x: 0, y: 0, z: 0 });
        });

        // Create edges
        edges.forEach(function (e) {
            var srcMesh = self.nodeMeshes.get(e.source);
            var tgtMesh = self.nodeMeshes.get(e.target);
            if (!srcMesh || !tgtMesh) return;
            var geo = new THREE.BufferGeometry().setFromPoints([
                srcMesh.position, tgtMesh.position
            ]);
            var mat = new THREE.LineBasicMaterial({
                color: 0xffffff, transparent: true, opacity: 0.25
            });
            var line = new THREE.Line(geo, mat);
            line.userData = { source: e.source, target: e.target, created: performance.now() };
            self.scene.add(line);
            self.edgeLines.push(line);
        });
    }

    _clearGraph() {
        var self = this;
        this.nodeMeshes.forEach(function (m) {
            m.geometry.dispose();
            m.material.dispose();
            self.scene.remove(m);
        });
        this.nodeMeshes.clear();
        this.edgeLines.forEach(function (l) {
            l.geometry.dispose();
            l.material.dispose();
            self.scene.remove(l);
        });
        this.edgeLines = [];
        this.velocities.clear();
    }

    addNodesWithAnimation(newNodes) {
        if (this._disabled) return;
        var self = this;
        newNodes.forEach(function (n, i) {
            var r = Math.max(0.05, 0.05 + 0.03 * Math.log((n.weight || 1) + 1));
            var geo = new THREE.SphereGeometry(r, 16, 12);
            var colorHex = self._groupColors[n.group] || FALLBACK_COLOR;
            var mat = new THREE.MeshPhongMaterial({
                color: new THREE.Color(colorHex),
                emissive: new THREE.Color('#ffffff'),
                emissiveIntensity: 1.5,
                specular: 0x222222,
                shininess: 20
            });
            var mesh = new THREE.Mesh(geo, mat);
            mesh.position.set(0, 0, 0);
            mesh.scale.setScalar(0.001);
            mesh.userData = {
                entityName: n.id, group: n.group, weight: n.weight,
                animStart: performance.now(),
                animDelay: i * 50,
                targetRadius: r,
                targetX: (Math.random() - 0.5) * 2,
                targetY: (Math.random() - 0.5) * 2,
                targetZ: (Math.random() - 0.5) * 2
            };
            self.scene.add(mesh);
            self.nodeMeshes.set(n.id, mesh);
            self.velocities.set(n.id, { x: 0, y: 0, z: 0 });
        });
    }

    addEdgesWithAnimation(newEdges) {
        if (this._disabled) return;
        var self = this;
        newEdges.forEach(function (e) {
            var srcMesh = self.nodeMeshes.get(e.source);
            var tgtMesh = self.nodeMeshes.get(e.target);
            if (!srcMesh || !tgtMesh) return;
            var geo = new THREE.BufferGeometry().setFromPoints([
                srcMesh.position, tgtMesh.position
            ]);
            var mat = new THREE.LineBasicMaterial({
                color: 0xffffff, transparent: true, opacity: 0.05
            });
            var line = new THREE.Line(geo, mat);
            line.userData = { source: e.source, target: e.target, created: performance.now() };
            self.scene.add(line);
            self.edgeLines.push(line);
        });
    }

    /* ── Force-directed physics (O(n²) with distance cutoff) ── */
    _tickPhysics(dt) {
        if (this._paused) return;
        var p = PHYSICS;
        var nodes = Array.from(this.nodeMeshes.values());
        var n = nodes.length;
        if (n === 0) return;
        var self = this;

        for (var i = 0; i < n; i++) {
            var fx = 0, fy = 0, fz = 0;
            var pi = nodes[i].position;

            // Coulomb repulsion
            for (var j = 0; j < n; j++) {
                if (i === j) continue;
                var pj = nodes[j].position;
                var dx = pi.x - pj.x, dy = pi.y - pj.y, dz = pi.z - pj.z;
                var dist = Math.sqrt(dx * dx + dy * dy + dz * dz) + 0.01;
                if (dist > p.maxInfluenceDist) continue;
                var force = p.coulombStrength / (dist * dist);
                fx += (dx / dist) * force;
                fy += (dy / dist) * force;
                fz += (dz / dist) * force;
            }

            // Center gravity
            fx -= p.centerGravity * pi.x;
            fy -= p.centerGravity * pi.y;
            fz -= p.centerGravity * pi.z;

            // Spring attraction on edges
            this.edgeLines.forEach(function (line) {
                var src = self.nodeMeshes.get(line.userData.source);
                var tgt = self.nodeMeshes.get(line.userData.target);
                if (src !== nodes[i] && tgt !== nodes[i]) return;
                var other = src === nodes[i] ? tgt : src;
                if (!other) return;
                var dx = pi.x - other.position.x;
                var dy = pi.y - other.position.y;
                var dz = pi.z - other.position.z;
                var d = Math.sqrt(dx * dx + dy * dy + dz * dz) + 0.01;
                var sf = p.springStrength * (d - p.springRestLength);
                fx -= (dx / d) * sf;
                fy -= (dy / d) * sf;
                fz -= (dz / d) * sf;
            });

            var v = this.velocities.get(nodes[i].userData.entityName);
            if (!v) continue;
            v.x = (v.x + fx * p.timeStep) * p.damping;
            v.y = (v.y + fy * p.timeStep) * p.damping;
            v.z = (v.z + fz * p.timeStep) * p.damping;

            var speed = Math.sqrt(v.x * v.x + v.y * v.y + v.z * v.z);
            if (speed > p.maxVelocity) {
                var s = p.maxVelocity / speed;
                v.x *= s; v.y *= s; v.z *= s;
            }
        }

        // Update node positions
        nodes.forEach(function (mesh) {
            var v = self.velocities.get(mesh.userData.entityName);
            if (!v) return;
            mesh.position.x += v.x;
            mesh.position.y += v.y;
            mesh.position.z += v.z;
        });
    }

    _updateEdges() {
        for (var i = 0; i < this.edgeLines.length; i++) {
            var line = this.edgeLines[i];
            var src = this.nodeMeshes.get(line.userData.source);
            var tgt = this.nodeMeshes.get(line.userData.target);
            if (!src || !tgt) continue;
            var pos = line.geometry.attributes.position;
            pos.setXYZ(0, src.position.x, src.position.y, src.position.z);
            pos.setXYZ(1, tgt.position.x, tgt.position.y, tgt.position.z);
            pos.needsUpdate = true;
        }
    }

    _animateNodeAnimations(now) {
        var self = this;
        this.nodeMeshes.forEach(function (mesh) {
            var ud = mesh.userData;
            if (!ud.animStart) return;
            if (now < ud.animStart + ud.animDelay) return;
            var elapsed = now - (ud.animStart + ud.animDelay);
            var duration = 600;
            var t = Math.min(elapsed / duration, 1.0);
            var e = 1 - Math.pow(1 - t, 3);  // ease-out cubic

            var s = ud.targetRadius * e;
            if (s < 0.001) s = 0.001;
            mesh.scale.setScalar(s);

            mesh.position.x = ud.targetX * e;
            mesh.position.y = ud.targetY * e;
            mesh.position.z = ud.targetZ * e;

            mesh.material.emissiveIntensity = 1.5 * (1 - e) + 0.3 * e;

            if (t >= 1.0) {
                delete ud.animStart;
                mesh.scale.setScalar(ud.targetRadius);
                mesh.position.set(ud.targetX, ud.targetY, ud.targetZ);
                mesh.material.emissiveIntensity = 0.3;
                mesh.material.emissive.set(mesh.material.color);
            }
        });
    }

    _animateEdgeAnimations(now) {
        for (var i = 0; i < this.edgeLines.length; i++) {
            var line = this.edgeLines[i];
            var elapsed = now - (line.userData.created || now);
            var t = Math.min(elapsed / 800, 1.0);
            line.material.opacity = 0.05 + 0.2 * t;
        }
    }

    _startLoop() {
        var self = this;
        function loop(now) {
            requestAnimationFrame(loop);
            if (self._disabled || self._paused) return;
            var dt = Math.min((now - self._lastTime) / 1000, 0.05);
            self._lastTime = now;
            self._tickPhysics(dt);
            self._animateNodeAnimations(now);
            self._animateEdgeAnimations(now);
            self._updateEdges();
            self.controls.update();
            self.renderer.render(self.scene, self.camera);
        }
        requestAnimationFrame(loop);
    }

    getStats() {
        return { nodes: this.nodeMeshes.size, edges: this.edgeLines.length };
    }

    dispose() {
        if (this._resizeObserver) this._resizeObserver.disconnect();
        this._clearGraph();
        if (this.renderer) {
            this.renderer.dispose();
            if (this.renderer.domElement && this.renderer.domElement.parentNode) {
                this.renderer.domElement.parentNode.removeChild(this.renderer.domElement);
            }
        }
    }
}

window.Graph3D = Graph3D;
