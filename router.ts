type Handler = (req: Request, params: Record<string, unknown>) =>
  | Promise<Response | void>
  | Response
  | void;

type Register = (pathname: string, handler: Handler) => void;

interface Route {
  method: string;
  pattern: URLPattern;
  handler: Handler;
}

export class Router {
  routes: Route[];
  defaultHeaders: Record<string, string>;
  get: Register;
  post: Register;

  constructor(defaultHeaders: Record<string, string> = {}) {
    this.routes = [];
    this.defaultHeaders = defaultHeaders;
    this.get = this.add.bind(this, 'GET');
    this.post = this.add.bind(this, 'POST');
  }

  add(method = 'GET', pathname = '', handler: Handler): void {
    this.routes.push({
      method,
      pattern: new URLPattern({ pathname }),
      handler,
    });
  }

  async handler(req: Request): Promise<Response> {
    let res: Response | void;

    for (const route of this.routes) {
      if (
        route.method === req.method &&
        (route.pattern.pathname === '*' || route.pattern.test(req.url))
      ) {
        const result = route.pattern.exec(req.url);
        const params = result?.pathname.groups || {};
        res = await route.handler(req, params);
        if (res) return this.applyHeaders(res);
      }
    }

    return this.applyHeaders(new Response('404', { status: 404 }));
  }

  private applyHeaders(res: Response): Response {
    const headers = new Headers(res.headers);
    for (const [key, value] of Object.entries(this.defaultHeaders)) {
      if (!headers.has(key)) headers.set(key, value);
    }
    return new Response(res.body, {
      status: res.status,
      statusText: res.statusText,
      headers,
    });
  }
}
