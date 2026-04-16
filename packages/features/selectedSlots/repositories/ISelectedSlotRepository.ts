import type { SelectedSlot } from "./dto/SelectedSlot";

export type TimeSlot = {
  utcStartIso: string;
  utcEndIso: string;
};

export interface ISelectedSlotRepository {
  findReservedByOthers(args: {
    slot: TimeSlot;
    eventTypeId: number;
    uid: string;
  }): Promise<SelectedSlot | null>;
  findManyReservedByOthers(
    slots: TimeSlot[],
    eventTypeId: number,
    uid: string
  ): Promise<Array<Pick<SelectedSlot, "slotUtcEndDate" | "slotUtcStartDate">>>;
  findManyUnexpiredSlots(args: {
    userIds: number[];
    currentTimeInUtc: string;
  }): Promise<Array<Omit<SelectedSlot, "releaseAt">>>;
  deleteManyExpiredSlots(args: { eventTypeId: number; currentTimeInUtc: string }): Promise<{ count: number }>;
  /**
   * Deletes all temporary slot reservations associated with a given browser-session uid.
   * Used to clean up stale seat reservations when a booking attempt fails, ensuring
   * that other users see the correct remaining seat count for the slot.
   */
  deleteByUid(uid: string): Promise<{ count: number }>;
}
