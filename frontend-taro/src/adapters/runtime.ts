export function resolveAdapterRuntime(env?: string) {
  return env === 'rn' ? 'rn' : env === 'weapp' ? 'weapp' : 'h5'
}
