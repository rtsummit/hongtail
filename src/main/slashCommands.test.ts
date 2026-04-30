import { describe, expect, it } from 'vitest'
import { sep } from 'path'
import {
  fileToCommandName,
  mergeCommandLists,
  parseFrontmatterDescription
} from './slashCommands'
import type { SlashCommand } from './slashCommands'

describe('parseFrontmatterDescription', () => {
  it('YAML frontmatter 의 description 추출', () => {
    const md = `---
description: 명령어 설명
other: x
---

본문`
    expect(parseFrontmatterDescription(md)).toBe('명령어 설명')
  })

  it('description 이 따옴표로 감싸있어도 벗겨낸다', () => {
    expect(
      parseFrontmatterDescription(`---
description: "쌍따옴표 설명"
---`)
    ).toBe('쌍따옴표 설명')
    expect(
      parseFrontmatterDescription(`---
description: '홑따옴표'
---`)
    ).toBe('홑따옴표')
  })

  it('CRLF line ending 도 지원', () => {
    const md = '---\r\ndescription: cr-lf 설명\r\n---\r\n본문'
    expect(parseFrontmatterDescription(md)).toBe('cr-lf 설명')
  })

  it('frontmatter 가 없으면 null', () => {
    expect(parseFrontmatterDescription('# 그냥 markdown')).toBeNull()
    expect(parseFrontmatterDescription('')).toBeNull()
  })

  it('frontmatter 안에 description 키가 없으면 null', () => {
    expect(
      parseFrontmatterDescription(`---
title: 제목만
---`)
    ).toBeNull()
  })

  it('description 끝의 trailing whitespace trim', () => {
    expect(
      parseFrontmatterDescription(`---
description:   spaced out
---`)
    ).toBe('spaced out')
  })
})

describe('fileToCommandName', () => {
  it('단일 파일은 basename', () => {
    expect(fileToCommandName(`${sep}root`, `${sep}root${sep}foo.md`)).toBe('foo')
  })

  it('하위 디렉토리는 콜론으로 join', () => {
    expect(
      fileToCommandName(`${sep}root`, `${sep}root${sep}sub${sep}cmd.md`)
    ).toBe('sub:cmd')
  })

  it('여러 단계 중첩', () => {
    expect(
      fileToCommandName(
        `${sep}root`,
        `${sep}root${sep}a${sep}b${sep}c.md`
      )
    ).toBe('a:b:c')
  })

  it('대문자 .MD 도 처리', () => {
    expect(fileToCommandName(`${sep}root`, `${sep}root${sep}foo.MD`)).toBe('foo')
  })
})

describe('mergeCommandLists', () => {
  const cmd = (name: string, source: SlashCommand['source']): SlashCommand => ({
    name,
    description: `${source} ${name}`,
    source,
    kind: 'command'
  })
  const skill = (name: string, source: SlashCommand['source']): SlashCommand => ({
    name,
    description: `${source} ${name}`,
    source,
    kind: 'skill'
  })

  it('빈 입력 → 빈 배열', () => {
    expect(mergeCommandLists([])).toEqual([])
    expect(mergeCommandLists([[], []])).toEqual([])
  })

  it('우선순위 — 먼저 오는 list 가 이김 (project > user)', () => {
    const merged = mergeCommandLists([
      [cmd('foo', 'project')],
      [cmd('foo', 'user')]
    ])
    expect(merged).toHaveLength(1)
    expect(merged[0].source).toBe('project')
  })

  it('command 와 skill 은 같은 이름이라도 별도', () => {
    const merged = mergeCommandLists([[cmd('x', 'user')], [skill('x', 'user')]])
    expect(merged).toHaveLength(2)
    expect(merged.map((m) => `${m.kind}:${m.name}`)).toEqual([
      'command:x',
      'skill:x'
    ])
  })

  it('동일 (kind, name) 의 후속은 모두 drop', () => {
    const merged = mergeCommandLists([
      [cmd('a', 'project')],
      [cmd('a', 'user'), cmd('a', 'plugin')] // 둘 다 drop
    ])
    expect(merged).toHaveLength(1)
    expect(merged[0].source).toBe('project')
  })

  it('출력은 name 기준 locale sort', () => {
    const merged = mergeCommandLists([
      [cmd('zebra', 'user'), cmd('alpha', 'user'), cmd('mango', 'user')]
    ])
    expect(merged.map((m) => m.name)).toEqual(['alpha', 'mango', 'zebra'])
  })

  it('list 내 중복도 처리 — 같은 list 안의 두 번째도 drop', () => {
    const merged = mergeCommandLists([
      [cmd('dup', 'user'), cmd('dup', 'user'), cmd('other', 'user')]
    ])
    expect(merged).toHaveLength(2)
    expect(merged.map((m) => m.name).sort()).toEqual(['dup', 'other'])
  })
})
