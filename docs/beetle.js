/**
 * beetle.js — a tiny ground beetle near plant stems during warm conditions
 *
 * A single ellipsoid body (~0.01 units long) that crawls slowly near plant
 * bases during Spring/Summer Clear weather in daytime. Freezes when the
 * camera moves. Fades out during Light Drizzle, Overcast, Night, or Winter.
 * Reduced-motion: appears/disappears with weather/season cues but never
 * animates crawling.
 *
 * Exports: createBeetle(scene) → { group, update }
 */

import * as THREE from "three";
import { isReducedMotion } from "./motion.js";

/* --- Configuration --- */
const BODY_LENGTH = 0.01;         // units — elongate sphere for beetle body
const BODY_WIDTH_RATIO = 0.6;     // width relative to length
const BODY_HEIGHT_RATIO = 0.35;   // height relative to length (flattened)
const BODY_COLOR = 0x2a1a0a;      // dark brown/black

/* Crawl parameters */
const CRAWL_SPEED = 0.005;        // units/s — very slow
const CRAWL_ARC_RADIUS = 0.04;    // units — short path near plant base
const CRAWL_ARC_OFFSET = 0.02;    // units — offset from plant stem center

/* Fade transition */
const FADE_TIME_CONSTANT = 2.5;   // seconds — exponential lerp (~86% after 5s)

/* Camera stillness: must be still for this long before crawling resumes */
const SETTLE_STILLNESS_MIN = 20;  // seconds — matches creature.js convention

/* --- Helper: determine if beetle should be visible --- */
function shouldBeVisible(season, weather, timeOfDay) {
  // Visible during Spring OR Summer AND Clear weather AND daytime (not Night)
  const isWarmSeason = season === 'Spring' || season === 'Summer';
  const isClear = weather === 'Clear';
  const isDaytime = timeOfDay !== 'Night';

  return isWarmSeason && isClear && isDaytime;
}

/**
 * Create the ground beetle, add it to the scene.
 *
 * @param {THREE.Scene} scene
 * @returns {{ group: THREE.Group, update: Function }}
 */
export function createBeetle(scene) {
  const group = new THREE.Group();
  group.name = 'ground-beetle';

  /* --- Body: a single ellipsoid (scaled sphere) --- */
  const bodyGeo = new THREE.SphereGeometry(BODY_LENGTH * 0.5, 8, 6);
  const bodyMat = new THREE.MeshStandardMaterial({
    color: BODY_COLOR,
    roughness: 0.85,
    metalness: 0.0,
    transparent: true,
    opacity: 0
  });
  const body = new THREE.Mesh(bodyGeo, bodyMat);
  body.scale.set(1, BODY_HEIGHT_RATIO, BODY_WIDTH_RATIO);
  body.position.y = 0.005; // just above ground surface
  group.add(body);

  /* Start invisible */
  group.visible = false;

  scene.add(group);

  /* --- Internal state --- */
  let _opacity = 0;                // current fade opacity [0,1]
  let _targetOpacity = 0;          // target fade opacity
  let _prevUpdateTime = -1;        // for dt calculation
  let _crawlPhase = 0;             // current phase along crawl arc (radians)
  let _crawlActive = false;        // whether crawling animation is running
  let _anchorPos = null;           // { x, z } — plant stem anchor
  let _anchorFound = false;        // whether we've found a plant anchor

  /* --- Determine anchor position: nearest plant stem --- */
  function findAnchor() {
    const gs = window.__gardenState;
    if (!gs) return null;

    // Try plant, plant2, plant3 in order — use first available
    const plantLabels = ['plant', 'plant2', 'plant3'];
    for (let i = 0; i < plantLabels.length; i++) {
      const plant = gs[plantLabels[i]];
      if (plant && plant.group) {
        const pos = plant.group.position;
        return { x: pos.x, z: pos.z };
      }
    }
    return null;
  }

  /* Attempt initial anchor */
  const initialAnchor = findAnchor();
  if (initialAnchor) {
    _anchorPos = initialAnchor;
    _anchorFound = true;
    // Place group at anchor + slight offset so beetle sits near the stem base
    group.position.set(
      _anchorPos.x + CRAWL_ARC_OFFSET,
      0.005,
      _anchorPos.z
    );
  }

  /* --- Update function, called every animation frame --- */
  function update(time) {
    /* Frame-rate-independent dt */
    let dt = 0.016;
    if (_prevUpdateTime >= 0) {
      dt = Math.max(0, Math.min(time - _prevUpdateTime, 0.05));
    }
    _prevUpdateTime = time;

    /* Re-check anchor on first frame or if plant changes */
    if (!_anchorFound) {
      const anchor = findAnchor();
      if (anchor) {
        _anchorPos = anchor;
        _anchorFound = true;
        group.position.set(
          _anchorPos.x + CRAWL_ARC_OFFSET,
          0.005,
          _anchorPos.z
        );
      }
    }

    /* Read current season, weather, time from DOM */
    const season = (document.getElementById('season-display')?.textContent || '').trim();
    const weather = (document.getElementById('weather-display')?.textContent || '').trim();
    const timeOfDay = (document.getElementById('time-display')?.textContent || '').trim();

    /* Determine target visibility */
    const shouldShow = shouldBeVisible(season, weather, timeOfDay);
    _targetOpacity = shouldShow ? 1.0 : 0.0;

    /* Check reduced motion */
    const reducedMotion = isReducedMotion();

    if (reducedMotion) {
      // No animation — just appear/disappear based on weather/season/time
      if (shouldShow && _anchorFound) {
        group.visible = true;
        bodyMat.opacity = 1.0;
        body.scale.set(1, BODY_HEIGHT_RATIO, BODY_WIDTH_RATIO);
        // Sit still at anchor — no crawl animation
        group.position.set(
          _anchorPos.x + CRAWL_ARC_OFFSET,
          0.005,
          _anchorPos.z
        );
      } else {
        group.visible = false;
        bodyMat.opacity = 0;
      }
      return;
    }

    /* --- Exponential fade toward target --- */
    if (_targetOpacity > _opacity) {
      _opacity = _opacity + (_targetOpacity - _opacity) * (1 - Math.exp(-dt / FADE_TIME_CONSTANT));
    } else {
      _opacity = _opacity + (_targetOpacity - _opacity) * (1 - Math.exp(-dt / FADE_TIME_CONSTANT));
    }

    // Clamp
    if (_opacity < 0.005) _opacity = 0;
    if (_opacity > 0.995) _opacity = 1;

    bodyMat.opacity = _opacity;

    /* Show/hide group based on opacity */
    if (_opacity > 0.005 && _anchorFound) {
      group.visible = true;
    } else {
      group.visible = false;
    }

    if (!_anchorFound || _opacity <= 0) return;

    /* --- Camera stillness check --- */
    let isCameraStill = true;
    if (window.__gardenState && typeof window.__gardenState._stillnessDuration === 'number') {
      const stillnessSec = window.__gardenState._stillnessDuration / 1000;
      isCameraStill = stillnessSec >= SETTLE_STILLNESS_MIN;
    }

    if (!isCameraStill) {
      // Camera just moved — freeze in place, don't advance crawl phase
      _crawlActive = false;
      return;
    }

    /* --- Crawl animation (only when camera is still) --- */
    _crawlActive = true;

    // Advance crawl phase slowly (~0.005 units/s)
    _crawlPhase += CRAWL_SPEED / CRAWL_ARC_RADIUS * dt;

    // Short arc near plant base: figure-eight or small looping path
    // Using a lemniscate-like pattern for organic appearance
    const arcX = Math.sin(_crawlPhase * 1.0) * CRAWL_ARC_RADIUS;
    const arcZ = Math.sin(_crawlPhase * 2.0) * CRAWL_ARC_RADIUS * 0.6;

    // Small forward drift to keep it from being too perfectly periodic
    const driftX = Math.sin(_crawlPhase * 0.3) * CRAWL_ARC_OFFSET * 0.3;

    group.position.x = _anchorPos.x + arcX + driftX;
    group.position.z = _anchorPos.z + arcZ;
    group.position.y = 0.005;

    // Subtle rotation to face direction of travel
    group.rotation.y = Math.atan2(
      Math.cos(_crawlPhase * 1.0) * CRAWL_ARC_RADIUS * 1.0,
      Math.cos(_crawlPhase * 2.0) * CRAWL_ARC_RADIUS * 2.0 * 0.6
    );
  }

  return { group, update };
}