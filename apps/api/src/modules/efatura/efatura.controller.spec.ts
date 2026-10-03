import { EFaturaController } from "./efatura.controller";
import { EFaturaError } from "./efatura.errors";

const config = {
  getView: jest.fn(),
  update: jest.fn(),
  setCertificate: jest.fn(),
  removeCertificate: jest.fn(),
};
const auth = { authorizeUrl: jest.fn(), handleCallback: jest.fn(), disconnect: jest.fn() };
const user = { sub: "admin-1", email: "a@b.cv", roles: ["admin"] };

let ctl: EFaturaController;
const res = () => ({ redirect: jest.fn() });

beforeEach(() => {
  jest.clearAllMocks();
  ctl = new EFaturaController(config as never, auth as never);
  config.getView.mockResolvedValue({ oauthRedirectUri: "https://app.cap.cv/api/efatura/oauth/callback" });
});

describe("EFaturaController", () => {
  it("is admin-only", () => {
    expect(Reflect.getMetadata("roles", EFaturaController)).toEqual(["admin"]);
  });

  it("returns the consent URL for the admin who asked", async () => {
    auth.authorizeUrl.mockResolvedValue("https://iam.efatura.cv/auth?x=1");
    expect(await ctl.authorize(user)).toEqual({ url: "https://iam.efatura.cv/auth?x=1" });
    expect(auth.authorizeUrl).toHaveBeenCalledWith("admin-1");
  });

  it("reports a configuration problem as a message instead of a 500", async () => {
    auth.authorizeUrl.mockRejectedValue(new EFaturaError("NOT_CONFIGURED", "Preencha o Client ID", false));
    expect(await ctl.authorize(user)).toEqual({ error: "Preencha o Client ID" });
  });

  describe("OAuth callback", () => {
    it("completes the connection and sends the admin back to Settings", async () => {
      const r = res();
      await ctl.callback("the-code", "the-state", undefined, user, r as never);
      expect(auth.handleCallback).toHaveBeenCalledWith("the-code", "the-state", "admin-1");
      expect(r.redirect).toHaveBeenCalledWith("https://app.cap.cv/settings?efatura=connected");
    });

    it("redirects with the reason when the platform reports an error or the code is missing", async () => {
      const r = res();
      await ctl.callback(undefined, undefined, "access_denied", user, r as never);
      expect(r.redirect).toHaveBeenCalledWith("https://app.cap.cv/settings?efatura=error&msg=access_denied");
      expect(auth.handleCallback).not.toHaveBeenCalled();
    });

    it("turns a failed exchange into a friendly redirect — never a stack trace", async () => {
      auth.handleCallback.mockRejectedValue(new EFaturaError("OAUTH_STATE", "O pedido de autorização expirou", false));
      const r = res();
      await ctl.callback("c", "s", undefined, user, r as never);
      expect(r.redirect).toHaveBeenCalledWith(`https://app.cap.cv/settings?efatura=error&msg=${encodeURIComponent("O pedido de autorização expirou")}`);
    });

    it("hides unexpected errors behind a generic message", async () => {
      auth.handleCallback.mockRejectedValue(new Error("redis password=hunter2"));
      const r = res();
      await ctl.callback("c", "s", undefined, user, r as never);
      expect(String(r.redirect.mock.calls[0][0])).not.toContain("hunter2");
    });
  });

  it("delegates configuration changes", async () => {
    config.update.mockResolvedValue({ ok: 1 });
    expect(await ctl.updateConfig({ serie: "A1" })).toEqual({ ok: 1 });
    await ctl.uploadCertificate({ file: "abc", password: "p" });
    expect(config.setCertificate).toHaveBeenCalledWith("abc", "p");
    await ctl.removeCertificate();
    expect(config.removeCertificate).toHaveBeenCalled();
  });
});
