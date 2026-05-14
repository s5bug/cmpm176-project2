import { defineConfig, loadEnv } from 'vite'

// https://vitejs.dev/config/
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '')
  let basePath: string
  if (env.GITHUB_ACTIONS === 'true') {
    basePath = `/${env.GITHUB_REPOSITORY.split('/')[1]}`
  } else {
    basePath = '/'
  }
  return {
    base: basePath,
  }
})
