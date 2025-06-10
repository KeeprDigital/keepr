type Env = {
  OP_CARDS_SERVICE: Fetcher
}

const ROUTE_MAP = {
  op: 'OP_CARDS_SERVICE',
} as const

function createServiceRequest(originalRequest: Request, newPath: string): Request {
  const url = new URL(originalRequest.url)
  url.pathname = newPath

  return new Request(url, {
    method: originalRequest.method,
    headers: originalRequest.headers,
    body: originalRequest.body,
  })
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url)
    const pathSegments = url.pathname.split('/').filter(Boolean)

    if (pathSegments.length === 0) {
      return new Response('API Gateway', { status: 200 })
    }

    const serviceName = pathSegments[0]
    const serviceBinding = ROUTE_MAP[serviceName as keyof typeof ROUTE_MAP]

    if (!serviceBinding) {
      return new Response(`Service '${serviceName}' not found`, { status: 404 })
    }

    // Strip service name from path
    const servicePath = `/${pathSegments.slice(1).join('/')}`
    const serviceRequest = createServiceRequest(request, servicePath)

    // Forward to service
    const targetService = env[serviceBinding]
    return targetService.fetch(serviceRequest)
  },
}
