import { beforeEach, describe, expect, it, vi } from "vitest";
import { KalshiAdapter } from "../kalshi-adapter";

const fetchMock = vi.hoisted(() => vi.fn());

function jsonResponse(body: unknown, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    text: async () => JSON.stringify(body),
    json: async () => body,
  };
}

vi.stubGlobal("fetch", fetchMock);

const TEST_PRIVATE_KEY_PEM = `-----BEGIN PRIVATE KEY-----
MIIEvQIBADANBgkqhkiG9w0BAQEFAASCBKcwggSjAgEAAoIBAQCkZ6x43jsu49dh
Qx+LLLSedAcJ/WUmEmCiyB4EpZ7M6T7/X1YJGum/Rm+eA5I5283yxs2GTMcwlpie
e/h64lahG3l4M9G4qLcOq9rWLyIBaPYFWlfCpiOxJHF6+3jdJ8Ej+57CDHjXWXHh
ROzDTOAQ4aUhs9s/STLHpNN61ECorKvaVfiaNsJ1F0QCupCPqHHep/tb4qDHZJ6q
LPkWM/vR0Rl5tY8vZ5imdez4CpZfSEHQtIyGAKAMkV+syWyB9+9pYdz40c1Cy/JE
YyQWn7X7sRSCtVpNKaLwgN+ileTgiZdRkhxjPRn6uOp0CQnHlzp51stbRkJKeDaY
O4i3rSaBAgMBAAECgf9LDSsVedVoknhZ3UqaLTTPqZ+NAP5ODa9DBuTPXGW7rhRY
gC0b2NgPm8Kt6GrpmG443bvCCuRbOOz7sM+LBT/cKhUWdTwmEFaSBq7gBwqhM8C1
faq0uc4Z7c1XvZcaCT8iclUpUbtyLVHghJaACQ+WHMGa9m8xUrCXhC+xa3gY/xAx
vAJ/hivztxVx/VAO3UbM31QbXqXo9UeZcWD2eATfio/aM7yuv6UQ/uKI4DntyL1Q
kk1Jqg9WbIeE7I9L1CC5GUSNQeuGlIQwqrdyllSXWDz3H6SwYGU3upGGT8193KJG
HSCsKZ9NbWxhbJTmH9g7kG6ohEDwbvLYZ3OFIV0CgYEA03w4x6IMnpxV5WVNuwiA
WmTpNosThzsXXFyOz6z55r612mT7SzMxUcAuApM/sx7lYsldhhM1Qg+APj3u3YLg
72S1GcZYboWdlIOumfQMwCsOXM3nhNTYv4ZSb3QCM+HMWOe59lJv6LDpDbeTcf0w
HV6xUo6Qp2x+fbV/hzlcXZ8CgYEAxwKOEVq8wKsAhkb1LVZI8mMTVUo9v0UF3szW
lEvqYwnY3pDKWkoB3P20PAi66Mpd5v11XTWt+457AW4Bq0hs0PRoJV5NZvQpvzk4
nSk11nbzjpNMuDxAfl707j1MAEjuCWW5VPkXm+XQm+ECmZDHVBwA0h/E/EvlOx9x
UPTvx98CgYEAuYpdYj+4pJrx/RzAclvGCAhKVtDzZAwitaR6opbWdGtSrnUzxsj1
9wwNEbNQCn0LsHyLsao+amOhFnpNi0dcwopvHFrYkLZnBrn0wBrN6PadVixLd00p
j/Zvclqr6Aqstj8u9n1isxoqjR9Gm5YO1WWTWqO7IzfbTbyjUuavM28CgYEApWXW
NU44edilgvQOaTPBRNJbCxO85e6zxkxwOqgtkUpp1/B2fTvs+IJS/WI0Fa27BXO5
y1IF24C7cqC++mAjMDcxJ32Mzvg2ihtAlj3d5PTPz7tUk/pfj6fT4P1I4SO70kud
EKZFnOgPzL3hr0fIonrzo6+LxDQ/vDeRsjsf3fkCgYEArFpauf+SLgr0FGFLjQxz
IPCy3DIgv2wsff83T9cZw2gVgu1486PQDIqhcMqxXUxPCp/EKfXXcWcI+GD3Ymum
bRdSX7S6OKlZ514MdSvgQsjyFjMFcogLESsq0Wm5dIM1NJxnJBgHjoa/RH0cypHb
8pQkc1dJKuRLdFDznyNJoA8=
-----END PRIVATE KEY-----`;

describe("KalshiAdapter money-field validation", () => {
  beforeEach(() => {
    fetchMock.mockReset();
  });

  function adapter() {
    return new KalshiAdapter(
      { keyId: "test-key", privateKeyPem: TEST_PRIVATE_KEY_PEM },
      "paper",
    );
  }

  it("throws BROKER_DATA when balance fields are absent", async () => {
    fetchMock.mockResolvedValue(jsonResponse({}));
    await expect(adapter().getAccountBalance()).rejects.toMatchObject({
      code: "BROKER_DATA",
    });
  });

  it("allows explicit zero balance", async () => {
    fetchMock.mockResolvedValue(jsonResponse({ balance: 0 }));
    await expect(adapter().getAccountBalance()).resolves.toBe(0);
  });

  it("throws BROKER_DATA when position exposure is missing", async () => {
    fetchMock.mockResolvedValue(
      jsonResponse({
        market_positions: [
          {
            ticker: "KXTEST-1",
            position: 5,
            realized_pnl: 100,
          },
        ],
      }),
    );
    await expect(adapter().getPositions()).rejects.toMatchObject({
      code: "BROKER_DATA",
    });
  });

  it("throws BROKER_DATA when market has no usable price", async () => {
    fetchMock.mockResolvedValue(
      jsonResponse({
        market: { ticker: "KXTEST-1", title: "Test" },
      }),
    );
    await expect(adapter().getMarketSnapshot("KXTEST-1")).rejects.toMatchObject(
      {
        code: "BROKER_DATA",
      },
    );
  });

  it("parses dollar quote fields without inventing zeros", async () => {
    fetchMock.mockResolvedValue(
      jsonResponse({
        market: {
          ticker: "KXTEST-1",
          title: "Test",
          yes_bid_dollars: "0.42",
          yes_ask_dollars: "0.48",
          last_price_dollars: "0.45",
        },
      }),
    );
    const snap = await adapter().getMarketSnapshot("KXTEST-1");
    expect(snap.price).toBe(0.45);
    expect(snap.bid).toBe(0.42);
    expect(snap.ask).toBe(0.48);
  });
});
