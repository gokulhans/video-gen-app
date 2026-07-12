import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:in_app_purchase/in_app_purchase.dart';

import '../../../core/api_client.dart';
import '../../../core/repositories/token_repository.dart';

/// Token purchase screen. Google Play Billing wiring is sketched with
/// `in_app_purchase`; the actual purchase flow is a TODO pending real
/// product ids configured in the Play Console and matching entries in the
/// `token_costs` / purchase catalog on the server.
///
/// Flow once wired up:
///  1. Query [InAppPurchase.instance.queryProductDetails] with [_productIds].
///  2. Kick off `buyConsumable` for the selected package.
///  3. Listen on `InAppPurchase.instance.purchaseStream`; on a verified
///     purchase update, POST the purchase token to the server for
///     server-side receipt validation via [TokenRepository.verifyPurchase].
///  4. Call `InAppPurchase.instance.completePurchase(purchase)` only after
///     the server confirms the credit was applied (avoids crediting twice
///     if verification fails and the user retries).
class PurchaseScreen extends ConsumerStatefulWidget {
  const PurchaseScreen({super.key});

  @override
  ConsumerState<PurchaseScreen> createState() => _PurchaseScreenState();
}

/// Token packages. Product ids must match Play Console "in-app product" ids.
const _packages = [
  (productId: 'tokens_500', tokens: 500, label: 'Starter pack'),
  (productId: 'tokens_1500', tokens: 1500, label: 'Creator pack'),
  (productId: 'tokens_5000', tokens: 5000, label: 'Studio pack'),
];

class _PurchaseScreenState extends ConsumerState<PurchaseScreen> {
  final InAppPurchase _iap = InAppPurchase.instance;
  StreamSubscription<List<PurchaseDetails>>? _subscription;
  bool _available = false;
  bool _busy = false;
  String? _pendingProductId;
  final Map<String, ProductDetails> _products = {};

  @override
  void initState() {
    super.initState();
    _init();
  }

  Future<void> _init() async {
    _available = await _iap.isAvailable();
    if (!mounted) return;
    setState(() {});
    _subscription = _iap.purchaseStream.listen(
      _onPurchaseUpdate,
      onError: (_) {},
    );
  }

  Future<void> _onPurchaseUpdate(List<PurchaseDetails> purchases) async {
    for (final purchase in purchases) {
      if (purchase.status == PurchaseStatus.purchased ||
          purchase.status == PurchaseStatus.restored) {
        try {
          await ref
              .read(tokenRepositoryProvider)
              .verifyPurchase(
                productId: purchase.productID,
                purchaseToken: purchase.verificationData.serverVerificationData,
              );
          await _iap.completePurchase(purchase);
          if (mounted) {
            setState(() {
              _pendingProductId = null;
              _busy = false;
            });
          }
          if (mounted) {
            ScaffoldMessenger.of(context).showSnackBar(
              const SnackBar(content: Text('Tokens added to your balance!')),
            );
          }
        } on ApiException catch (e) {
          if (mounted) {
            setState(() {
              _pendingProductId = null;
              _busy = false;
            });
          }
          if (mounted) {
            ScaffoldMessenger.of(context).showSnackBar(
              SnackBar(
                content: Text('Purchase verification failed: ${e.message}'),
              ),
            );
          }
        } catch (error) {
          if (mounted) {
            setState(() {
              _pendingProductId = null;
              _busy = false;
            });
            ScaffoldMessenger.of(context).showSnackBar(
              SnackBar(content: Text('Purchase verification failed: $error')),
            );
          }
        }
      } else if (purchase.status == PurchaseStatus.error) {
        if (mounted) {
          setState(() {
            _pendingProductId = null;
            _busy = false;
          });
        }
        if (mounted) {
          ScaffoldMessenger.of(context).showSnackBar(
            SnackBar(content: Text('Purchase error: ${purchase.error}')),
          );
        }
      }
    }
    if (mounted && _pendingProductId == null) setState(() => _busy = false);
  }

  Future<void> _buy(String productId) async {
    if (!_available) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(
          content: Text(
            'Billing is unavailable on this device. Configure the store product catalog and release build before enabling purchases.',
          ),
        ),
      );
      return;
    }
    setState(() {
      _busy = true;
      _pendingProductId = productId;
    });
    try {
      final response = await _iap.queryProductDetails({productId});
      if (response.productDetails.isEmpty) {
        throw Exception('Product not found in store listing');
      }
      _products[productId] = response.productDetails.first;
      final purchaseParam = PurchaseParam(
        productDetails: _products[productId]!,
      );
      await _iap.buyConsumable(purchaseParam: purchaseParam);
    } catch (e) {
      if (mounted) {
        ScaffoldMessenger.of(
          context,
        ).showSnackBar(SnackBar(content: Text('Could not start purchase: $e')));
      }
      setState(() => _pendingProductId = null);
    } finally {
      // The store flow is asynchronous; keep the action disabled until the
      // purchase stream reports a purchased/restored/error terminal state.
      if (mounted && _pendingProductId == null) setState(() => _busy = false);
    }
  }

  @override
  void dispose() {
    _subscription?.cancel();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('Buy tokens')),
      body: ListView(
        padding: const EdgeInsets.all(16),
        children: [
          if (!_available)
            Card(
              color: Theme.of(context).colorScheme.errorContainer,
              child: const Padding(
                padding: EdgeInsets.all(16),
                child: Text(
                  'Purchases are verified server-side. Product IDs must exist in the matching store release and server-owned catalog before launch.',
                ),
              ),
            ),
          const SizedBox(height: 16),
          ..._packages.map(
            (pkg) => Padding(
              padding: const EdgeInsets.only(bottom: 12),
              child: Card(
                child: ListTile(
                  leading: const Icon(Icons.toll_outlined),
                  title: Text(pkg.label),
                  subtitle: Text('${pkg.tokens} tokens'),
                  trailing: _pendingProductId == pkg.productId && _busy
                      ? const SizedBox(
                          width: 20,
                          height: 20,
                          child: CircularProgressIndicator(strokeWidth: 2),
                        )
                      : FilledButton(
                          onPressed: () => _buy(pkg.productId),
                          child: const Text('Buy'),
                        ),
                ),
              ),
            ),
          ),
        ],
      ),
    );
  }
}
