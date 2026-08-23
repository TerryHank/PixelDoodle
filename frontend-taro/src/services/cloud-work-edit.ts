import type { PrivateCloudWork } from '@/types/private-cloud'
import { readPersistedState, writePersistedState } from '@/utils/persistence'

const PENDING_CLOUD_WORK_KEY = 'pixeldoodle:pending-cloud-work-edit'

export function savePendingCloudWorkEdit(work: PrivateCloudWork) {
  return writePersistedState(PENDING_CLOUD_WORK_KEY, work)
}

export function consumePendingCloudWorkEdit() {
  const work = readPersistedState<PrivateCloudWork | null>(
    PENDING_CLOUD_WORK_KEY,
    null
  )
  writePersistedState(PENDING_CLOUD_WORK_KEY, null)
  return work
}
