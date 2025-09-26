import { Controller, Get, Header, Render } from '@nestjs/common';
import { ApiExcludeController } from '@nestjs/swagger';
import { MetricService } from './metric.service';

@Controller()
@ApiExcludeController()
export class MetricController {
  constructor(private readonly metricService: MetricService) {}

  @Get('metrics')
  @Render('metrics')
  @Header(
    'Content-Security-Policy',
    "script-src 'self' https://cdn.jsdelivr.net 'unsafe-inline'",
  )
  metrics() {
    return this.metricService.getMetrics();
  }

  @Get('health-check')
  healthCheck() {
    return {
      status: 'healthy',
      timestamp: new Date().toISOString(),
      version: '2.2.0',
      database: 'connected',
      services: {
        nostr: 'active',
        websocket: 'active',
        database: 'connected'
      }
    };
  }
}
