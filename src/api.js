import * as THREE from 'three';
import { registerEntity, registerTile, registerAbility, entityTypes, tileTypes, abilityTypes } from './engine/registry.js';
import { Entity, Body } from './engine/entity.js';
import * as physics from './engine/physics.js';
import * as constants from './engine/constants.js';
import { sketchMaterial, outlineMaterial, addOutline, customShader, shared } from './render/materials.js';
import { Character } from './render/models.js';
import { Sketch, canvasTexture } from './render/draw.js';
import { Player } from './entities/player.js';
import { sfx } from './game/audio.js';

/**
 * Публичный API для модов. Мод — это ES-модуль:
 *   export default function (api) { api.registerEntity('spring', { cls: ..., editor: {...} }) }
 * Подключение: в public/levels/index.json → "mods": ["mods/my-mod.js"],
 * или в меню «Моды» по URL.
 */
export const api = {
  version: 1,
  THREE,
  registerEntity, registerTile, registerAbility,
  entityTypes, tileTypes, abilityTypes,
  Entity, Body, Player,
  physics, constants,
  render: { sketchMaterial, outlineMaterial, addOutline, customShader, shared, Character, Sketch, canvasTexture },
  sfx,
};

if (typeof window !== 'undefined') window.Chrono = api;
