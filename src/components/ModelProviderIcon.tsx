import React from 'react';
import { Blocks, Server } from 'lucide-react';
import type { ModelBrand } from '../services/hermesModelCatalog';
import openai from '../assets/model-providers/openai.svg';
import anthropic from '../assets/model-providers/claude-color.svg';
import github from '../assets/model-providers/githubcopilot.svg';
import google from '../assets/model-providers/gemini-color.svg';
import deepseek from '../assets/model-providers/deepseek-color.svg';
import qwen from '../assets/model-providers/qwen-color.svg';
import minimax from '../assets/model-providers/minimax-color.svg';
import xai from '../assets/model-providers/grok.svg';
import openrouter from '../assets/model-providers/openrouter.svg';
import ollama from '../assets/model-providers/ollama.svg';
import mistral from '../assets/model-providers/mistral-color.svg';
import moonshot from '../assets/model-providers/kimi-color.svg';
import zai from '../assets/model-providers/zai.svg';
import nous from '../assets/model-providers/nousresearch.svg';
const icons = { openai, anthropic, github, google, deepseek, qwen, minimax, xai, openrouter, ollama, mistral, moonshot, zai, nous };

export function ModelProviderIcon({ brand, size = 32 }: { brand: ModelBrand; size?: number }) {
  const icon = brand === 'custom' || brand === 'unknown' ? null : icons[brand];
  const compact = size <= 20;
  const glyphSize = Math.round(size * (compact ? 0.72 : 0.65));
  return <span aria-hidden="true" className={`inline-flex shrink-0 items-center justify-center ${compact ? 'rounded border border-slate-200/80' : 'rounded-lg border border-slate-200'}`} style={{ width: size, height: size, backgroundColor: '#fff', color: '#64748b' }}>
    {icon ? <img src={icon} alt="" draggable={false} style={{ width: glyphSize, height: glyphSize }} /> : brand === 'custom' ? <Server size={Math.round(size * 0.6)} /> : <Blocks size={Math.round(size * 0.6)} />}
  </span>;
}
