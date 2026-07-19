import test from 'node:test'
import assert from 'node:assert/strict'

import {
  normalizeStoryboardMovement,
  storyboardMovementLabel,
  STORYBOARD_MOVEMENT_OPTION_GROUPS,
} from '../src/utils/storyboardMovement.js'

test('normalizes combined Chinese and enum movement values used by AI storyboards', () => {
  const cases = {
    跟镜tracking: 'tracking',
    荷兰角dutch_angle_move: 'dutch_angle_move',
    横摇pan: 'pan',
    环绕orbit: 'orbit',
    降镜crane_dn: 'crane_dn',
    拉镜pull: 'pull',
    升格环绕slowmo_orbit: 'slowmo_orbit',
    甩镜whip_pan: 'whip_pan',
    推轨复合dolly_track: 'dolly_track',
    推镜push: 'push',
    希区柯克hitchcock_zoom: 'hitchcock_zoom',
    旋转roll: 'roll',
    纵摇tilt: 'tilt',
  }
  for (const [raw, expected] of Object.entries(cases)) {
    assert.equal(normalizeStoryboardMovement(raw), expected)
  }
})

test('keeps standard movement values and exposes their display labels', () => {
  assert.equal(normalizeStoryboardMovement('whip_pan'), 'whip_pan')
  assert.equal(storyboardMovementLabel('甩镜whip_pan'), '甩镜')

  const optionValues = STORYBOARD_MOVEMENT_OPTION_GROUPS.flatMap((group) =>
    group.options.map((option) => option.value)
  )
  assert.ok(optionValues.includes('whip_pan'))
  assert.ok(optionValues.includes('dolly_track'))
})
