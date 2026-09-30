#pragma once
extern "C" { void *malloc(unsigned long); unsigned long strlen(const char *); char *strcpy(char *, const char *); }
typedef signed char BOOL;
#define YES ((BOOL)1)
#define NO ((BOOL)0)
typedef long NSInteger; typedef unsigned long NSUInteger;
#define nil nullptr
#define NULL nullptr
#define API_AVAILABLE(...)
#define NS_ASSUME_NONNULL_BEGIN
typedef const void *CFTypeRef; typedef const struct __CFDictionary *CFDictionaryRef; typedef const struct __CFString *CFStringRef; typedef int OSStatus;
__attribute__((objc_root_class)) @interface NSObject { Class isa; }
+ (instancetype)alloc; - (instancetype)init; - (BOOL)isKindOfClass:(Class)c; + (Class)class;
@end
@protocol NSObject @end
@interface NSString : NSObject
+ (instancetype)stringWithUTF8String:(const char *)s; - (const char *)UTF8String; - (instancetype)initWithData:(id)d encoding:(NSUInteger)e; - (id)dataUsingEncoding:(NSUInteger)e; @property (readonly) NSUInteger length;
@end
@interface NSData : NSObject @end
@interface NSNumber : NSObject + (NSNumber *)numberWithBool:(BOOL)b; @end
@interface NSArray : NSObject + (instancetype)arrayWithObjects:(const id [])objects count:(NSUInteger)cnt; @end
@interface NSDictionary : NSObject + (instancetype)dictionaryWithObjects:(const id [])objects forKeys:(const id [])keys count:(NSUInteger)cnt; @end
@interface NSMutableDictionary : NSDictionary + (instancetype)dictionary; - (void)setObject:(id)o forKeyedSubscript:(id)k; @end
@interface NSError : NSObject @property (readonly) NSInteger code; @property (readonly, copy) NSString *localizedDescription; @end
@interface NSJSONSerialization : NSObject + (NSData *)dataWithJSONObject:(id)o options:(NSUInteger)opt error:(NSError **)e; @end
enum { NSUTF8StringEncoding = 4 };
typedef void (^dispatch_block_t)(void); typedef struct dispatch_queue_s *dispatch_queue_t;
dispatch_queue_t dispatch_get_main_queue(void); void dispatch_async(dispatch_queue_t q, dispatch_block_t b);
