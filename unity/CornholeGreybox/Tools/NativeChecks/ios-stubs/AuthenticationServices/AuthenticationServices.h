#pragma once
@interface UIWindow : NSObject @end
typedef UIWindow *ASPresentationAnchor;
@class ASAuthorizationController, ASAuthorization;
@protocol ASAuthorizationControllerDelegate <NSObject>
@optional - (void)authorizationController:(ASAuthorizationController *)c didCompleteWithAuthorization:(ASAuthorization *)a; - (void)authorizationController:(ASAuthorizationController *)c didCompleteWithError:(NSError *)e;
@end
@protocol ASAuthorizationControllerPresentationContextProviding <NSObject>
- (ASPresentationAnchor)presentationAnchorForAuthorizationController:(ASAuthorizationController *)c;
@end
@interface ASAuthorizationRequest : NSObject @end
@interface ASAuthorizationOpenIDRequest : ASAuthorizationRequest @property (copy) NSArray *requestedScopes; @property (copy) NSString *nonce; @end
@interface ASAuthorizationAppleIDRequest : ASAuthorizationOpenIDRequest @end
@interface ASAuthorizationAppleIDProvider : NSObject - (ASAuthorizationAppleIDRequest *)createRequest; @end
@interface ASAuthorizationController : NSObject - (instancetype)initWithAuthorizationRequests:(NSArray *)r; @property (weak) id<ASAuthorizationControllerDelegate> delegate; @property (weak) id<ASAuthorizationControllerPresentationContextProviding> presentationContextProvider; - (void)performRequests; @end
@interface ASAuthorization : NSObject @property (readonly, strong) id credential; @end
@interface ASAuthorizationAppleIDCredential : NSObject @property (readonly, copy) NSData *identityToken; @end
enum { ASAuthorizationErrorCanceled = 1001 };
