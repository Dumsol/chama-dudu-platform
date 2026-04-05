import { promises as fs } from 'fs'
import { join } from 'node:path'

const dataDir = join(process.cwd(), '.data')

export const getDataPath = (fileName: string) => join(dataDir, fileName)

export async function readJson<T>(fileName: string, fallback: T): Promise<T> {
  const filePath = getDataPath(fileName)
  try {
    const content = await fs.readFile(filePath, 'utf8')
    return JSON.parse(content) as T
  } catch (error) {
    const err = error as NodeJS.ErrnoException
    if (err?.code === 'ENOENT') {
      await writeJsonAtomic(fileName, fallback)
      return fallback
    }
    throw error
  }
}

export async function writeJsonAtomic(fileName: string, data: unknown): Promise<void> {
  await fs.mkdir(dataDir, { recursive: true })
  const filePath = getDataPath(fileName)
  const tmpPath = `${filePath}.${Date.now()}.tmp`
  await fs.writeFile(tmpPath, JSON.stringify(data, null, 2), 'utf8')
  await fs.rename(tmpPath, filePath)
}
