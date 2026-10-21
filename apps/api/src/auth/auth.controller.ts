import { Body, Controller, Get, HttpCode, Inject, Param, Patch, Post } from '@nestjs/common';
import { ZodValidationPipe } from '@jobpilot/kit';
import { CurrentUser, Public, RequirePermission, type Principal } from '../common/auth.js';
import {
  addMemberSchema,
  idParamsSchema,
  backchannelLogoutSchema,
  type BackchannelLogout,
  oidcExchangeSchema,
  type OidcExchange,
  loginSchema,
  refreshSchema,
  registerSchema,
  selectOrganizationSchema,
  updateMemberSchema,
  updateOrganizationSchema,
  type AddMember,
  type Login,
  type RefreshRequest,
  type Register,
  type SelectOrganization,
  type UpdateMember,
  type UpdateOrganization,
} from './auth.contract.js';
import { AuthService } from './auth.service.js';
import { OidcService } from './oidc.service.js';

@Controller('api/v1')
export class AuthController {
  constructor(
    @Inject(AuthService) private readonly auth: AuthService,
    @Inject(OidcService) private readonly oidc: OidcService,
  ) {}

  @Public()
  @Get('auth/oidc/config')
  oidcConfig() {
    return this.oidc.publicConfig();
  }

  @Public()
  @Post('auth/oidc/exchange')
  @HttpCode(200)
  oidcExchange(@Body(new ZodValidationPipe(oidcExchangeSchema)) body: OidcExchange) {
    return this.oidc.exchange(body);
  }

  /** The identity provider's back-channel logout: a signed token (form encoded) saying a person signed out or was disabled there. */
  @Public()
  @Post('auth/backchannel-logout')
  @HttpCode(200)
  async backchannelLogout(
    @Body(new ZodValidationPipe(backchannelLogoutSchema)) body: BackchannelLogout,
  ) {
    await this.oidc.handleBackchannelLogout(body.logout_token);
    return {};
  }

  @Public()
  @Post('auth/register')
  register(@Body(new ZodValidationPipe(registerSchema)) body: Register) {
    return this.auth.register(body);
  }

  /** One organization: tokens. Several: a selection token and the list to choose from. */
  @Public()
  @Post('auth/login')
  @HttpCode(200)
  login(@Body(new ZodValidationPipe(loginSchema)) body: Login) {
    return this.auth.login(body);
  }

  @Public()
  @Post('auth/select-organization')
  @HttpCode(200)
  selectOrganization(
    @Body(new ZodValidationPipe(selectOrganizationSchema)) body: SelectOrganization,
  ) {
    return this.auth.selectOrganization(body);
  }

  @Public()
  @Post('auth/refresh')
  @HttpCode(200)
  refresh(@Body(new ZodValidationPipe(refreshSchema)) body: RefreshRequest) {
    return this.auth.refresh(body.refreshToken);
  }

  @Public()
  @Post('auth/logout')
  @HttpCode(204)
  async logout(@Body(new ZodValidationPipe(refreshSchema)) body: RefreshRequest) {
    await this.auth.logout(body.refreshToken);
  }

  @Get('me')
  me(@CurrentUser() p: Principal) {
    return this.auth.me(p);
  }

  @RequirePermission('organizations:manage')
  @Patch('organization')
  rename(
    @CurrentUser() p: Principal,
    @Body(new ZodValidationPipe(updateOrganizationSchema)) body: UpdateOrganization,
  ) {
    return this.auth.renameOrganization(p, body);
  }

  @RequirePermission('members:read')
  @Get('organization/members')
  listMembers(@CurrentUser() p: Principal) {
    return this.auth.listMembers(p);
  }

  @RequirePermission('members:invite')
  @Post('organization/members')
  addMember(
    @CurrentUser() p: Principal,
    @Body(new ZodValidationPipe(addMemberSchema)) body: AddMember,
  ) {
    return this.auth.addMember(p, body);
  }

  @RequirePermission('members:invite')
  @Patch('organization/members/:id')
  updateMember(
    @CurrentUser() p: Principal,
    @Param(new ZodValidationPipe(idParamsSchema)) params: { id: string },
    @Body(new ZodValidationPipe(updateMemberSchema)) body: UpdateMember,
  ) {
    return this.auth.updateMember(p, params.id, body);
  }
}
