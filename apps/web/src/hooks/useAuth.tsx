import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";
import { ApiClientError, apiRequest, setCsrfToken } from "../lib/api-client.js";
import { useTheme, type ThemeMode } from "../stores/theme.js";

export interface AuthUser {
  id: string;
  email: string;
  displayName: string;
  themePreference: ThemeMode;
  createdAt: string;
}

interface AuthResponse {
  user: AuthUser;
  csrfToken: string;
}

interface AuthContextValue {
  user: AuthUser | null;
  loading: boolean;
  login: (input: { email: string; password: string }) => Promise<AuthUser>;
  register: (input: { email: string; password: string; displayName: string }) => Promise<AuthUser>;
  logout: () => Promise<void>;
  refreshSession: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [loading, setLoading] = useState(true);
  const { setTheme } = useTheme();

  const applySession = useCallback(
    (data: AuthResponse) => {
      setCsrfToken(data.csrfToken);
      setUser(data.user);
      if (data.user.themePreference) {
        setTheme(data.user.themePreference);
      }
    },
    [setTheme],
  );

  const refreshSession = useCallback(async () => {
    try {
      const data = await apiRequest<AuthResponse>("/api/auth/me");
      applySession(data);
    } catch (err) {
      if (err instanceof ApiClientError && err.status === 401) {
        setCsrfToken(null);
        setUser(null);
      }
    } finally {
      setLoading(false);
    }
  }, [applySession]);

  useEffect(() => {
    let active = true;
    apiRequest<AuthResponse>("/api/auth/me")
      .then((data) => {
        if (active) applySession(data);
      })
      .catch((err) => {
        if (active && err instanceof ApiClientError && err.status === 401) {
          setCsrfToken(null);
          setUser(null);
        }
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [applySession]);

  const login = useCallback(
    async (input: { email: string; password: string }) => {
      const data = await apiRequest<AuthResponse>("/api/auth/login", {
        method: "POST",
        body: JSON.stringify(input),
      });
      applySession(data);
      return data.user;
    },
    [applySession],
  );

  const register = useCallback(
    async (input: { email: string; password: string; displayName: string }) => {
      const data = await apiRequest<AuthResponse>("/api/auth/register", {
        method: "POST",
        body: JSON.stringify(input),
      });
      applySession(data);
      return data.user;
    },
    [applySession],
  );

  const logout = useCallback(async () => {
    try {
      await apiRequest("/api/auth/logout", { method: "POST" });
    } finally {
      setCsrfToken(null);
      setUser(null);
    }
  }, []);

  return (
    <AuthContext.Provider value={{ user, loading, login, register, logout, refreshSession }}>
      {children}
    </AuthContext.Provider>
  );
}

// eslint-disable-next-line react-refresh/only-export-components
export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}
