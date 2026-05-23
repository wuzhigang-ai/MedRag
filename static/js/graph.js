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
        this._hovered = null;
        this._raycaster = new THREE.Raycaster();
        this._mouse = new THREE.Vector2();
        this._tooltip = null;

        if (!this._checkWebGL()) {
            container.innerHTML = '<div class="graph-fallback">您的浏览器不支持 WebGL，无法显示 3D 知识图谱</div>';
            this._disabled = true;
            return;
        }

        this._initScene();
        this._initHover();
        this._initParticles();
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
        this.scene.background = new THREE.Color(0x050510);

        var w = this.container.clientWidth || 800;
        var h = this.container.clientHeight || 600;
        this.camera = new THREE.PerspectiveCamera(55, w / h, 0.5, 100);
        this.camera.position.set(6, 4, 10);
        this.camera.lookAt(0, 0, 0);

        this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
        this.renderer.setSize(w, h);
        this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
        this.container.appendChild(this.renderer.domElement);

        // Ambient + key light for depth
        this.scene.add(new THREE.AmbientLight(0x303060, 1.8));
        var key = new THREE.DirectionalLight(0xffffff, 0.9);
        key.position.set(15, 20, 10);
        this.scene.add(key);

        // Rim/fill light from below for cinematic look
        var fill = new THREE.DirectionalLight(0x4466aa, 0.5);
        fill.position.set(-10, -5, -5);
        this.scene.add(fill);

        // Point light at center for node glow
        var point = new THREE.PointLight(0x6688cc, 0.4, 20);
        point.position.set(0, 0, 0);
        this.scene.add(point);

        this.controls = new OrbitControls(this.camera, this.renderer.domElement);
        this.controls.enableDamping = true;
        this.controls.dampingFactor = 0.08;
        this.controls.minDistance = 2;
        this.controls.maxDistance = 30;
        this.controls.autoRotate = true;
        this.controls.autoRotateSpeed = 0.15;

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

    _initParticles() {
        var count = 300;
        var geo = new THREE.BufferGeometry();
        var positions = new Float32Array(count * 3);
        for (var i = 0; i < count * 3; i += 3) {
            positions[i] = (Math.random() - 0.5) * 20;
            positions[i + 1] = (Math.random() - 0.5) * 20;
            positions[i + 2] = (Math.random() - 0.5) * 20;
        }
        geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
        var mat = new THREE.PointsMaterial({
            color: 0x4466aa,
            size: 0.015,
            transparent: true,
            opacity: 0.6,
            blending: THREE.AdditiveBlending,
            depthWrite: false
        });
        this._particles = new THREE.Points(geo, mat);
        this.scene.add(this._particles);
    }

    _initHover() {
        // Create tooltip div
        this._tooltip = document.createElement('div');
        this._tooltip.className = 'graph-tooltip';
        this._tooltip.style.cssText =
            'position:absolute;display:none;pointer-events:none;z-index:2000;' +
            'background:rgba(8,8,24,0.94);border:1px solid rgba(255,255,255,0.12);' +
            'border-radius:8px;padding:10px 14px;color:#e2e8f0;font-size:12px;' +
            'line-height:1.6;max-width:260px;backdrop-filter:blur(12px);' +
            'box-shadow:0 8px 32px rgba(0,0,0,0.5);transition:opacity 0.15s;';
        this.container.appendChild(this._tooltip);

        var self = this;
        this._onMouseMove = function (e) {
            var rect = self.renderer.domElement.getBoundingClientRect();
            self._mouse.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
            self._mouse.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
        };
        this.renderer.domElement.addEventListener('mousemove', this._onMouseMove);

        // Cursor style
        this.renderer.domElement.style.cursor = 'grab';
        this.renderer.domElement.addEventListener('mousedown', function () {
            self.renderer.domElement.style.cursor = 'grabbing';
        });
        this.renderer.domElement.addEventListener('mouseup', function () {
            self.renderer.domElement.style.cursor = 'grab';
        });
    }

    _updateHover() {
        this._raycaster.setFromCamera(this._mouse, this.camera);

        var nodes = Array.from(this.nodeMeshes.values());
        var intersects = this._raycaster.intersectObjects(nodes, false);

        if (intersects.length > 0) {
            var obj = intersects[0].object;
            if (this._hovered !== obj) {
                this._unhighlightNode();
                this._hovered = obj;
                this._highlightNode(obj);
                this._showTooltip(obj);
                this.renderer.domElement.style.cursor = 'pointer';
            }
        } else {
            if (this._hovered) {
                this._unhighlightNode();
                this._hideTooltip();
                this._hovered = null;
                this.renderer.domElement.style.cursor = 'grab';
            }
        }
    }

    _highlightNode(mesh) {
        mesh._origScale = mesh.scale.x;
        mesh._origEmissive = mesh.material.emissiveIntensity;
        mesh._origEmissiveColor = mesh.material.emissive.getHex();

        mesh.scale.setScalar(mesh._origScale * 1.6);
        mesh.material.emissive.set(0xffffff);
        mesh.material.emissiveIntensity = 0.9;

        // Highlight connected edges
        var name = mesh.userData.entityName;
        var self = this;
        this.edgeLines.forEach(function (line) {
            if (line.userData.source === name || line.userData.target === name) {
                line._origOpacity = line.material.opacity;
                line.material.opacity = 0.8;
                line.material.color.set(0xffffff);
            }
        });
    }

    _unhighlightNode() {
        if (!this._hovered) return;
        var mesh = this._hovered;

        if (mesh._origScale) {
            mesh.scale.setScalar(mesh._origScale);
            delete mesh._origScale;
        }
        if (mesh._origEmissive !== undefined) {
            mesh.material.emissiveIntensity = mesh._origEmissive;
            mesh.material.emissive.setHex(mesh._origEmissiveColor || 0);
            delete mesh._origEmissive;
            delete mesh._origEmissiveColor;
        }

        // Restore connected edges
        var name = mesh.userData.entityName;
        var self = this;
        this.edgeLines.forEach(function (line) {
            if (line.userData.source === name || line.userData.target === name) {
                if (line._origOpacity !== undefined) {
                    line.material.opacity = line._origOpacity;
                    line.material.color.set(0xffffff);
                    delete line._origOpacity;
                }
            }
        });
    }

    _showTooltip(mesh) {
        if (!this._tooltip) return;
        var ud = mesh.userData;
        var html = '<div style="font-weight:600;font-size:13px;margin-bottom:4px;color:#fff;">' +
            this._escHtml(ud.entityName) + '</div>' +
            '<div style="color:#94a3b8;">来源: ' + this._escHtml(ud.group || '未知') + '</div>' +
            '<div style="color:#94a3b8;">关联: ' + (ud.weight || 0) + ' 个文本块</div>';

        // Count connected edges
        var name = ud.entityName;
        var edgeCount = 0;
        this.edgeLines.forEach(function (l) {
            if (l.userData.source === name || l.userData.target === name) edgeCount++;
        });
        html += '<div style="color:#94a3b8;">关系: ' + edgeCount + ' 条边</div>';

        this._tooltip.innerHTML = html;
        this._tooltip.style.display = 'block';

        // Position near mouse
        var self = this;
        var moveHandler = function (e) {
            var rect = self.container.getBoundingClientRect();
            var x = e.clientX - rect.left + 16;
            var y = e.clientY - rect.top - 10;
            // Keep tooltip within bounds
            if (x + 270 > rect.width) x = e.clientX - rect.left - 270;
            if (y + 120 > rect.height) y = e.clientY - rect.top - 130;
            self._tooltip.style.left = x + 'px';
            self._tooltip.style.top = y + 'px';
        };
        this.renderer.domElement.addEventListener('mousemove', moveHandler);
        this._tooltipMoveHandler = moveHandler;
    }

    _hideTooltip() {
        if (this._tooltip) {
            this._tooltip.style.display = 'none';
        }
        if (this._tooltipMoveHandler) {
            this.renderer.domElement.removeEventListener('mousemove', this._tooltipMoveHandler);
            this._tooltipMoveHandler = null;
        }
    }

    _escHtml(str) {
        if (!str) return '';
        var d = document.createElement('div');
        d.appendChild(document.createTextNode(str));
        return d.innerHTML;
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
                specular: 0x444444,
                shininess: 30
            });
            var mesh = new THREE.Mesh(geo, mat);

            // Add glow ring
            var ringGeo = new THREE.TorusGeometry(r * 1.35, 0.015, 8, 16);
            var ringMat = new THREE.MeshBasicMaterial({
                color: new THREE.Color(colorHex),
                transparent: true,
                opacity: 0.35,
                depthWrite: false
            });
            var ring = new THREE.Mesh(ringGeo, ringMat);
            mesh.add(ring);

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

        // Create edges with gradient-like thin lines
        edges.forEach(function (e) {
            var srcMesh = self.nodeMeshes.get(e.source);
            var tgtMesh = self.nodeMeshes.get(e.target);
            if (!srcMesh || !tgtMesh) return;
            var geo = new THREE.BufferGeometry().setFromPoints([
                srcMesh.position, tgtMesh.position
            ]);
            var mat = new THREE.LineBasicMaterial({
                color: 0x334466,
                transparent: true,
                opacity: 0.18,
                depthWrite: false
            });
            var line = new THREE.Line(geo, mat);
            line.userData = { source: e.source, target: e.target, created: performance.now() };
            self.scene.add(line);
            self.edgeLines.push(line);
        });
    }

    _clearGraph() {
        var self = this;
        this._hovered = null;
        this.nodeMeshes.forEach(function (m) {
            m.children.forEach(function (c) {
                if (c.geometry) c.geometry.dispose();
                if (c.material) c.material.dispose();
            });
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
                specular: 0x444444,
                shininess: 30
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
                color: 0x4466aa, transparent: true, opacity: 0.05, depthWrite: false
            });
            var line = new THREE.Line(geo, mat);
            line.userData = { source: e.source, target: e.target, created: performance.now() };
            self.scene.add(line);
            self.edgeLines.push(line);
        });
    }

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

            fx -= p.centerGravity * pi.x;
            fy -= p.centerGravity * pi.y;
            fz -= p.centerGravity * pi.z;

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
            var e = 1 - Math.pow(1 - t, 3);

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
            line.material.opacity = 0.05 + 0.13 * t;
        }
    }

    _animateParticles(now) {
        if (!this._particles) return;
        this._particles.rotation.y += 0.0001;
        this._particles.rotation.x += 0.00005;
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
            self._animateParticles(now);
            self._updateEdges();
            self._updateHover();
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
        if (this._onMouseMove) {
            this.renderer.domElement.removeEventListener('mousemove', this._onMouseMove);
        }
        this._hideTooltip();
        if (this._tooltip && this._tooltip.parentNode) {
            this._tooltip.parentNode.removeChild(this._tooltip);
        }
        this._clearGraph();
        if (this._particles) {
            this._particles.geometry.dispose();
            this._particles.material.dispose();
            this.scene.remove(this._particles);
        }
        if (this.renderer) {
            this.renderer.dispose();
            if (this.renderer.domElement && this.renderer.domElement.parentNode) {
                this.renderer.domElement.parentNode.removeChild(this.renderer.domElement);
            }
        }
    }
}

window.Graph3D = Graph3D;
