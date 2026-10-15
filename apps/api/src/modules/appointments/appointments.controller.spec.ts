import { ForbiddenException } from "@nestjs/common";
import { AppointmentsController } from "./appointments.controller";

// Reception checks the patient in; the doctor starts the consultation; admin may do either.
describe("AppointmentsController.updateStatus — who may move which status", () => {
  const service = { updateStatus: jest.fn().mockResolvedValue({}) };
  const controller = new AppointmentsController(service as never);
  const as = (roles: string[]) => ({ sub: "s1", email: "x@cap.cv", roles });
  const call = (status: "checked_in" | "in_progress" | "completed", roles: string[]) =>
    Promise.resolve().then(() => controller.updateStatus("id", { status }, as(roles)));

  beforeEach(() => service.updateStatus.mockClear());

  it.each([
    ["checked_in", "doctor"], ["checked_in", "nurse"], ["in_progress", "receptionist"], ["in_progress", "nurse"],
  ] as const)("refuses %s for a %s", async (status, role) => {
    await expect(call(status, [role])).rejects.toBeInstanceOf(ForbiddenException);
    expect(service.updateStatus).not.toHaveBeenCalled();
  });

  it.each([
    ["checked_in", "receptionist"], ["in_progress", "doctor"], ["checked_in", "admin"], ["in_progress", "admin"], ["completed", "doctor"],
  ] as const)("allows %s for a %s", async (status, role) => {
    await call(status, [role]);
    expect(service.updateStatus).toHaveBeenCalledWith("id", { status }, "s1");
  });
});
