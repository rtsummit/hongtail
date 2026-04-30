#!/usr/bin/env node
/**
 * build/icon.svg → build/icon.png, build/icon.ico, resources/icon.png 갱신.
 * sharp 로 다중 사이즈 PNG 를 굽고 png-to-ico 로 .ico 로 묶는다.
 */
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import sharp from 'sharp'
import pngToIco from 'png-to-ico'

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..')
const masterSvg = join(repoRoot, 'build', 'icon.svg')

const buildPng = join(repoRoot, 'build', 'icon.png')
const buildIco = join(repoRoot, 'build', 'icon.ico')
const resourcesPng = join(repoRoot, 'resources', 'icon.png')

async function rasterize(svg, size) {
  return sharp(svg).resize(size, size).png().toBuffer()
}

async function main() {
  const svg = await readFile(masterSvg)

  // build/icon.png — electron-builder Linux/Mac base. 1024 권장.
  const png1024 = await rasterize(svg, 1024)
  await mkdir(dirname(buildPng), { recursive: true })
  await writeFile(buildPng, png1024)
  console.log(`▸ ${buildPng}  (1024×1024)`)

  // resources/icon.png — Electron BrowserWindow 의 윈도우 아이콘.
  const png256 = await rasterize(svg, 256)
  await mkdir(dirname(resourcesPng), { recursive: true })
  await writeFile(resourcesPng, png256)
  console.log(`▸ ${resourcesPng}  (256×256)`)

  // build/icon.ico — Windows 아이콘. 16~256 multi-resolution.
  const sizes = [16, 24, 32, 48, 64, 128, 256]
  const pngs = await Promise.all(sizes.map((s) => rasterize(svg, s)))
  const ico = await pngToIco(pngs)
  await writeFile(buildIco, ico)
  console.log(`▸ ${buildIco}  (${sizes.join(',')})`)

  console.log('\n✓ build/icon.svg → PNG/ICO 갱신 완료')
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
