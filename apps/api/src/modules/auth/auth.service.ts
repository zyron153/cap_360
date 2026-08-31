import { Injectable, GoneException, UnauthorizedException } from "@nestjs/common";
import { LoginDto, ResetPasswordDto, AuthenticatedStaff } from "@cap/types";
import { SessionService } from "./session.service";
import { PasswordService } from "../../common/services/password.service";
import { StaffRepository } from "../staff/staff.repository";
import { NotificationsService } from "../notifications/notifications.service";

// A real argon2id hash of an arbitrary string — used only so a login attempt against a
// nonexistent email still pays the same argon2 cost as a real one, instead of returning
// early and letting response timing reveal whether the account exists.
const DUMMY_HASH = "$argon2id$v=19$m=65536,t=3,p=4$qCNmC5LLQNO7OaMzxgBY4A$tYYYr+cIWo8Gm8IBZ6sF9OEzL0KwAaEr7ElVdQ+P19A";

const LOGIN_ERROR = "Email ou palavra-passe incorretos.";
const LOCKED_ERROR = "Conta temporariamente bloqueada devido a demasiadas tentativas falhadas. Tente novamente mais tarde.";

@Injectable()
export class AuthService {
  constructor(
    private readonly sessions: SessionService,
    private readonly password: PasswordService,
    private readonly staffRepo: StaffRepository,
    private readonly notifications: NotificationsService,
  ) {}

  async login(dto: LoginDto): Promise<{ sessionId: string; staff: AuthenticatedStaff }> {
    if (await this.sessions.isLocked(dto.email)) {
      throw new UnauthorizedException(LOCKED_ERROR);
    }

    const staff = await this.staffRepo.findByEmailWithPassword(dto.email);
    const ok = await this.password.verify(staff?.passwordHash ?? DUMMY_HASH, dto.password);

    if (!staff || !ok) {
      await this.sessions.recordFailure(dto.email);
      throw new UnauthorizedException(LOGIN_ERROR);
    }

    await this.sessions.clearFailures(dto.email);
    const sessionId = await this.sessions.create({
      staffId: staff.id,
      email: staff.email,
      roles: [staff.role],
    });

    return {
      sessionId,
      staff: { id: staff.id, email: staff.email, fullName: staff.fullName, role: staff.role },
    };
  }

  async logout(sessionId: string): Promise<void> {
    await this.sessions.destroy(sessionId);
  }

  /** Always resolves without error, whether or not the email belongs to a real account —
   * the response must not let a caller enumerate valid staff emails. */
  async forgotPassword(email: string): Promise<void> {
    const staff = await this.staffRepo.findByEmail(email);
    if (!staff) return;

    const token = await this.sessions.createResetToken(staff.id);
    await this.notifications.sendPasswordReset(staff.email, staff.fullName, token);
  }

  async resetPassword(dto: ResetPasswordDto): Promise<void> {
    const staffId = await this.sessions.consumeResetToken(dto.token);
    if (!staffId) throw new GoneException("Este link de recuperação é inválido ou expirou.");

    const passwordHash = await this.password.hash(dto.password);
    await this.staffRepo.updatePasswordHash(staffId, passwordHash);
  }
}
