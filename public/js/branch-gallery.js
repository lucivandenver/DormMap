(function () {
  function slidesFor(listing) {
    const galleries = listing.branchGalleries || [];
    const selected = galleries.findIndex(branch => branch.branchNumber === listing.branchNumber);
    const ordered = selected > 0 ? [...galleries.slice(selected), ...galleries.slice(0, selected)] : galleries;
    return ordered.flatMap(branch => branch.photos.map(photo => ({
      url: photo.url,
      caption: `Branch ${branch.branchNumber}`
    })));
  }
  window.DormBranchGallery = { slidesFor };
}());
