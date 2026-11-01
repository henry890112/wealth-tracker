export const SUPPORT_RESISTANCE_LAYER_STRATEGIES = new Set(['price-sr-touch', 'price-sr-flip']);

export function resolveStrategyLayers(layers, selectedAnalysis) {
  return SUPPORT_RESISTANCE_LAYER_STRATEGIES.has(selectedAnalysis)
    ? { ...layers, levels: true }
    : layers;
}
