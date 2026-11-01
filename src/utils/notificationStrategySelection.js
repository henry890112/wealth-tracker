export function resolveSavedNotificationStrategies(savedStrategies, allowedKeys, defaultStrategies) {
  if (!Array.isArray(savedStrategies)) return [...defaultStrategies];
  const validStrategies = [...new Set(savedStrategies.filter(key => allowedKeys.has(key)))];
  return validStrategies.length ? validStrategies : [...defaultStrategies];
}
