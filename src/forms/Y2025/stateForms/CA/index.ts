import F1040 from 'ustaxes/forms/Y2025/irsForms/F1040'
import CA540 from './CA540'

export const makeCA540 = (f1040: F1040): CA540 => new CA540(f1040)
export default makeCA540
