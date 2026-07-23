export type CharacterGender = 'male' | 'female' | 'unknown'

export const getCharacterGender = (prompt: string): CharacterGender => {
    const firstTag = prompt.split(',')[0]?.trim().toLowerCase()
    if (['boy', '1boy', 'male', 'faceless male', 'monster boy'].includes(firstTag)) return 'male'
    if (['girl', '1girl', 'female', 'faceless female', 'monster girl'].includes(firstTag)) return 'female'
    return 'unknown'
}
