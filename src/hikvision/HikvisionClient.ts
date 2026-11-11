import * as https from 'https';
import * as http from 'http';
import { URL } from 'url';
import { HikvisionAuth } from './HikvisionAuth';
import { HikvisionConfig, HikvisionError } from './types';
import { mockHikvisionHandler } from './MockHikvisionHandler';

interface HttpResponse {
  statusCode: number;
  headers: http.IncomingHttpHeaders;
  data: string;
}

export class HikvisionClient {
  private config: HikvisionConfig;
  private auth: HikvisionAuth;
  private httpsAgent: https.Agent;
  private httpAgent: http.Agent;
  private pendingAuthRefresh: Promise<void> | null = null;

  constructor(config: HikvisionConfig) {
    this.config = {
      host: config.host.replace(/\/+$/, ''),
      username: config.username,
      password: config.password || '',
      verifyTls: config.verifyTls ?? false,
      timeoutMs: config.timeoutMs ?? 12000,
      isMock: config.isMock ?? (process.env.HIKVISION_MOCK === 'true'),
    };
    this.auth = new HikvisionAuth();
    this.httpsAgent = new https.Agent({
      rejectUnauthorized: this.config.verifyTls,
      keepAlive: true,
      keepAliveMsecs: 30000,
      maxSockets: 4,
    });
    this.httpAgent = new http.Agent({
      keepAlive: true,
      keepAliveMsecs: 30000,
      maxSockets: 4,
    });
  }

  public updateConfig(partialConfig: Partial<HikvisionConfig>): void {
    this.config = {
      ...this.config,
      ...partialConfig,
      host: partialConfig.host ? partialConfig.host.replace(/\/+$/, '') : this.config.host,
    };
    if (partialConfig.verifyTls !== undefined) {
      this.httpsAgent = new https.Agent({
        rejectUnauthorized: this.config.verifyTls,
        keepAlive: true,
        keepAliveMsecs: 30000,
        maxSockets: 4,
      });
    }
    this.auth.resetChallenge();
    this.pendingAuthRefresh = null;
  }

  public getConfig(): Omit<HikvisionConfig, 'password'> {
    const { password: _, ...safeConfig } = this.config;
    return safeConfig;
  }

  private executeRequest(
    targetUrl: URL,
    method: string,
    headers: Record<string, string>,
    bodyStr?: string
  ): Promise<HttpResponse> {
    return new Promise((resolve, reject) => {
      const isHttps = targetUrl.protocol === 'https:';
      const transport = isHttps ? https : http;
      const agent = isHttps ? this.httpsAgent : this.httpAgent;

      const options: https.RequestOptions = {
        protocol: targetUrl.protocol,
        hostname: targetUrl.hostname,
        port: targetUrl.port || (isHttps ? 443 : 80),
        path: `${targetUrl.pathname}${targetUrl.search}`,
        method,
        headers,
        agent,
        timeout: this.config.timeoutMs,
      };

      const req = transport.request(options, (res) => {
        let responseData = '';
        res.setEncoding('utf8');

        res.on('data', (chunk) => {
          responseData += chunk;
        });

        res.on('end', () => {
          resolve({
            statusCode: res.statusCode || 500,
            headers: res.headers,
            data: responseData,
          });
        });
      });

      req.on('timeout', () => {
        req.destroy();
        reject(
          new HikvisionError(
            `Request to terminal timed out after ${this.config.timeoutMs}ms. Check that your Public IP and port forwarding are active.`,
            'TIMEOUT_ERROR',
            408
          )
        );
      });

      req.on('error', (err: any) => {
        reject(
          new HikvisionError(
            `Network error communicating with Hikvision terminal (${this.config.host}): ${err.message || 'Unknown network error'}`,
            'NETWORK_ERROR',
            502,
            { code: err.code }
          )
        );
      });

      if (bodyStr) {
        req.write(bodyStr);
      }
      req.end();
    });
  }

  public async request<T = any>(
    method: string,
    endpointPath: string,
    body?: unknown,
    retryCount = 0
  ): Promise<T> {
    if (this.config.isMock || process.env.HIKVISION_MOCK === 'true') {
      return mockHikvisionHandler.handleRequest(method, endpointPath, body) as T;
    }

    const cleanPath = endpointPath.startsWith('/') ? endpointPath : `/${endpointPath}`;
    const targetUrl = new URL(`${this.config.host}${cleanPath}`);
    const uri = `${targetUrl.pathname}${targetUrl.search}`;

    const headers: Record<string, string> = {
      Accept: 'application/json, text/plain, */*',
    };

    let bodyStr: string | undefined;
    if (body !== undefined && body !== null) {
      bodyStr = typeof body === 'string' ? body : JSON.stringify(body);
      headers['Content-Type'] = bodyStr.trim().startsWith('<') ? 'application/xml' : 'application/json';
      headers['Content-Length'] = Buffer.byteLength(bodyStr).toString();
    }

    if (this.pendingAuthRefresh && !this.auth.getChallenge()) {
      await this.pendingAuthRefresh.catch(() => {});
    }

    if (this.auth.getChallenge()) {
      try {
        const authHeader = this.auth.generateAuthorizationHeader(
          method,
          uri,
          this.config.username,
          this.config.password || ''
        );
        headers['Authorization'] = authHeader;
      } catch {
        this.auth.resetChallenge();
      }
    }

    let response: HttpResponse;
    if (!this.auth.getChallenge() && !this.pendingAuthRefresh) {
      let resolveRefresh!: () => void;
      this.pendingAuthRefresh = new Promise<void>((res) => {
        resolveRefresh = res;
      });
      try {
        response = await this.executeRequest(targetUrl, method, headers, bodyStr);
        if (response.statusCode === 401) {
          const authHeader = response.headers['www-authenticate'] || response.headers['WWW-Authenticate'];
          const challengeStr = Array.isArray(authHeader) ? authHeader[0] : authHeader;
          if (challengeStr) {
            this.auth.parseChallenge(challengeStr);
          }
        }
      } finally {
        this.pendingAuthRefresh = null;
        resolveRefresh();
      }
    } else {
      response = await this.executeRequest(targetUrl, method, headers, bodyStr);
    }

    if (response.statusCode === 401) {
      if (retryCount >= 2) {
        throw new HikvisionError(
          'Authentication failed with Hikvision device (invalid username or password)',
          'AUTHENTICATION_FAILED',
          401
        );
      }

      const authHeader = response.headers['www-authenticate'] || response.headers['WWW-Authenticate'];
      const challengeStr = Array.isArray(authHeader) ? authHeader[0] : authHeader;

      if (!challengeStr) {
        throw new HikvisionError(
          'Device returned 401 without WWW-Authenticate header',
          'INVALID_AUTH_CHALLENGE',
          401
        );
      }

      const challenge = this.auth.parseChallenge(challengeStr);
      if (!challenge) {
        throw new HikvisionError(
          'Could not parse Digest challenge from WWW-Authenticate header',
          'MALFORMED_AUTH_CHALLENGE',
          401
        );
      }

      return this.request<T>(method, endpointPath, body, retryCount + 1);
    }

    if (response.statusCode < 200 || response.statusCode >= 300) {
      let errorDetails: unknown = response.data;
      try {
        errorDetails = JSON.parse(response.data);
      } catch {
        // keep text
      }
      throw new HikvisionError(
        `Hikvision ISAPI returned error status ${response.statusCode}`,
        'ISAPI_ERROR',
        response.statusCode,
        errorDetails
      );
    }

    try {
      if (!response.data || response.data.trim() === '') {
        return {} as T;
      }
      return JSON.parse(response.data) as T;
    } catch {
      return response.data as unknown as T;
    }
  }

  public async get<T = any>(path: string): Promise<T> {
    return this.request<T>('GET', path);
  }

  public async post<T = any>(path: string, body?: unknown): Promise<T> {
    return this.request<T>('POST', path, body);
  }

  public async put<T = any>(path: string, body?: unknown): Promise<T> {
    return this.request<T>('PUT', path, body);
  }

  public async delete<T = any>(path: string): Promise<T> {
    return this.request<T>('DELETE', path);
  }
}
