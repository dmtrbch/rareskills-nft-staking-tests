const { expect } = require("chai");
const { ethers } = require("hardhat");
const { utils } = ethers;
const { BigNumber } = ethers;

function revertReason(reason) {
  return `VM Exception while processing transaction: reverted with reason string '${reason}'`;
}

describe("NFT Staker", function () {
  let myTokenContract = null;
  let myNftContract = null;
  let nftStakerContract = null;
  let provider = null;
  let accounts = null;
  const DEFAULT_USER = 0;
  const FIRST_USER_ID = 1;
  const ATTACKER_ID = 9;
  const TOKENS_PER_NFT = 10;
  const SECONDS_IN_DAY = 86400;

  beforeEach(async function () {
    const MyTokenContractFactory = await ethers.getContractFactory("MyToken");
    myTokenContract = await MyTokenContractFactory.deploy();
    await myTokenContract.deployed();

    const MyNftContractFactory = await ethers.getContractFactory("MyNft");
    myNftContract = await MyNftContractFactory.deploy();
    await myNftContract.deployed();

    const NftStakerFactory = await ethers.getContractFactory("NftStaker");
    nftStakerContract = await NftStakerFactory.deploy(
      myTokenContract.address,
      myNftContract.address
    );
    await nftStakerContract.deployed();

    provider = await ethers.provider;
    accounts = await ethers.getSigners();
  });

  describe("MyToken: mintTokens", async function () {
    it("should allow the owner of the contract to mint tokens", async function () {
      const tokensAmount = 300;

      await expect(
        myTokenContract.mintTokens(
          accounts[FIRST_USER_ID].address,
          tokensAmount
        )
      ).to.not.be.reverted;

      expect(
        await myTokenContract.balanceOf(accounts[FIRST_USER_ID].address)
      ).to.be.equal(
        new BigNumber.from(utils.parseEther(tokensAmount.toString()))
      );
    });

    it("should revert the transaction if the account that tries to mint tokens is not the owner", async function () {
      const tokensAmount = 300;

      await expect(
        myTokenContract
          .connect(accounts[ATTACKER_ID])
          .mintTokens(accounts[FIRST_USER_ID].address, tokensAmount)
      ).to.be.revertedWith(revertReason("Ownable: caller is not the owner"));
    });
  });

  describe("MyNft: safeMint", async function () {
    it("should allow the owner of the contract to mint NFT", async function () {
      const tokenId = 1;

      await expect(
        myNftContract.safeMint(accounts[FIRST_USER_ID].address, tokenId)
      ).to.not.be.reverted;

      expect(await myNftContract.ownerOf(tokenId))
        .to.be.a("string")
        .equal(accounts[FIRST_USER_ID].address);
    });

    it("should revert the transaction if the account that tries to mint the NFT is not the owner", async function () {
      const tokenId = 2;

      await expect(
        myNftContract
          .connect(accounts[ATTACKER_ID])
          .safeMint(accounts[FIRST_USER_ID].address, tokenId)
      ).to.be.revertedWith(revertReason("Ownable: caller is not the owner"));
    });
  });

  describe("NftStaker: onERC721Received (staking NFT)", async function () {
    it("should allow depositing NFT to the staking contract", async function () {
      const tokenId = 1;

      const mintNftTx = await myNftContract.safeMint(
        accounts[DEFAULT_USER].address,
        tokenId
      );
      await mintNftTx.wait();

      const transferNftTx = await myNftContract[
        "safeTransferFrom(address,address,uint256)"
      ](accounts[DEFAULT_USER].address, nftStakerContract.address, tokenId);
      await transferNftTx.wait();

      expect(await myNftContract.ownerOf(tokenId))
        .to.be.a("string")
        .equal(nftStakerContract.address);
    });

    it("should set the originalOwner inside NFtStaker.sol equal to the account that is transfering the NFT", async function () {
      const tokenId = 1;

      const mintNftTx = await myNftContract.safeMint(
        accounts[DEFAULT_USER].address,
        tokenId
      );
      await mintNftTx.wait();

      const transferNftTx = await myNftContract[
        "safeTransferFrom(address,address,uint256)"
      ](accounts[DEFAULT_USER].address, nftStakerContract.address, tokenId);
      await transferNftTx.wait();

      expect(await nftStakerContract.originalOwner(tokenId))
        .to.be.a("string")
        .equal(accounts[DEFAULT_USER].address);
    });
  });

  describe("NftStaker: withdrawNFT (unstaking NFT)", async function () {
    it("should allow user to withdraw/unstake NFT from the staking contract", async function () {
      const tokenId = 1;

      const mintNftTx = await myNftContract.safeMint(
        accounts[DEFAULT_USER].address,
        tokenId
      );
      await mintNftTx.wait();

      const transferNftTx = await myNftContract[
        "safeTransferFrom(address,address,uint256)"
      ](accounts[DEFAULT_USER].address, nftStakerContract.address, tokenId);
      await transferNftTx.wait();

      await expect(nftStakerContract.withdrawNFT(tokenId)).to.not.be.reverted;

      expect(await myNftContract.ownerOf(tokenId))
        .to.be.a("string")
        .equal(accounts[DEFAULT_USER].address);
    });

    it("should revert the transaction if the account that tries to withdraw the NFT is not original owner of the NFT", async function () {
      const tokenId = 1;

      const mintNftTx = await myNftContract.safeMint(
        accounts[DEFAULT_USER].address,
        tokenId
      );
      await mintNftTx.wait();

      const transferNftTx = await myNftContract[
        "safeTransferFrom(address,address,uint256)"
      ](accounts[DEFAULT_USER].address, nftStakerContract.address, tokenId);
      await transferNftTx.wait();

      await expect(
        nftStakerContract.connect(accounts[ATTACKER_ID]).withdrawNFT(tokenId)
      ).to.be.revertedWith(revertReason("You're not owner of this NFT"));
    });

    it("should calulate rewards in 24 hours for the withdrawn NFT and save it to userRewards mapping", async function () {
      const tokenId = 1;
      const currentDate = Math.floor(new Date().getTime() / 1000);
      const dateAfterOneDay =
        Math.floor(new Date().getTime() / 1000) + SECONDS_IN_DAY;

      const mintNftTx = await myNftContract.safeMint(
        accounts[DEFAULT_USER].address,
        tokenId
      );
      await mintNftTx.wait();

      const transferNftTx = await myNftContract[
        "safeTransferFrom(address,address,uint256)"
      ](accounts[DEFAULT_USER].address, nftStakerContract.address, tokenId);
      await transferNftTx.wait();

      const aproximateRewards =
        ((dateAfterOneDay - currentDate) * TOKENS_PER_NFT) / SECONDS_IN_DAY;

      await provider.send("evm_increaseTime", [24 * 60 * 60 + 1]);

      await expect(nftStakerContract.withdrawNFT(tokenId)).to.not.be.reverted;

      expect(
        await nftStakerContract.userRewards(accounts[DEFAULT_USER].address)
      ).to.be.equal(new BigNumber.from(aproximateRewards.toString()));
    });
  });

  describe("NftStaker: claimRewards (unstaking NFT)", async function () {
    it("should revert if user tries to claim rewards in less than 24 hours - recurring", async function () {
      const tx = await myTokenContract.transferOwnership(
        nftStakerContract.address
      );
      await tx.wait();

      const tokenId = 1;

      const mintNftTx = await myNftContract.safeMint(
        accounts[DEFAULT_USER].address,
        tokenId
      );
      await mintNftTx.wait();

      const transferNftTx = await myNftContract[
        "safeTransferFrom(address,address,uint256)"
      ](accounts[DEFAULT_USER].address, nftStakerContract.address, tokenId);
      await transferNftTx.wait();

      await expect(nftStakerContract.claimRewards()).to.be.revertedWith(
        revertReason("You can claim rewards once in 24 hours")
      );
    });

    it("should revert if user has no rewards", async function () {
      const tx = await myTokenContract.transferOwnership(
        nftStakerContract.address
      );
      await tx.wait();

      const tokenId = 1;

      const mintNftTx = await myNftContract.safeMint(
        accounts[DEFAULT_USER].address,
        tokenId
      );
      await mintNftTx.wait();

      await expect(nftStakerContract.claimRewards()).to.be.revertedWith(
        revertReason("No rewards for claiming")
      );
    });

    it("should allow the user to claim rewards", async function () {
      const tx = await myTokenContract.transferOwnership(
        nftStakerContract.address
      );
      await tx.wait();

      const tokenId = 1;

      const currentDate = Math.floor(new Date().getTime() / 1000);
      const dateAfterOneDay =
        Math.floor(new Date().getTime() / 1000) + SECONDS_IN_DAY;

      const aproximateRewards =
        ((dateAfterOneDay - currentDate) * TOKENS_PER_NFT) / SECONDS_IN_DAY;

      const mintNftTx = await myNftContract.safeMint(
        accounts[DEFAULT_USER].address,
        tokenId
      );
      await mintNftTx.wait();

      const transferNftTx = await myNftContract[
        "safeTransferFrom(address,address,uint256)"
      ](accounts[DEFAULT_USER].address, nftStakerContract.address, tokenId);
      await transferNftTx.wait();

      await provider.send("evm_increaseTime", [24 * 60 * 60 + 1]);

      await expect(nftStakerContract.claimRewards()).to.not.be.reverted;

      expect(
        await myTokenContract.balanceOf(accounts[DEFAULT_USER].address)
      ).to.be.equal(
        new BigNumber.from(
          utils.parseUnits(aproximateRewards.toString(), "ether")
        )
      );
    });
  });

  describe("NftStaker: totalStakedBy", async function () {
    it("should return to total amount of NFTs staked for a particualr user", async function () {
      let tokenId = 1;

      for (let i = 0; i < 3; i++) {
        const mintNftTx = await myNftContract.safeMint(
          accounts[DEFAULT_USER].address,
          tokenId
        );
        await mintNftTx.wait();

        const transferNftTx = await myNftContract[
          "safeTransferFrom(address,address,uint256)"
        ](accounts[DEFAULT_USER].address, nftStakerContract.address, tokenId);
        await transferNftTx.wait();

        tokenId++;
      }

      expect(
        await nftStakerContract.totalStakedBy(accounts[DEFAULT_USER].address)
      ).to.be.equal(new BigNumber.from(3));
    });
  });

  describe("NftStaker: nftsOfStaker", async function () {
    it("should return array with the tokenIds corresponding to the NFTs that are staked for a particualr user", async function () {
      const tokenIds = [1, 2, 3];

      for (let i = 0; i < 3; i++) {
        const mintNftTx = await myNftContract.safeMint(
          accounts[DEFAULT_USER].address,
          tokenIds[i]
        );
        await mintNftTx.wait();

        const transferNftTx = await myNftContract[
          "safeTransferFrom(address,address,uint256)"
        ](
          accounts[DEFAULT_USER].address,
          nftStakerContract.address,
          tokenIds[i]
        );
        await transferNftTx.wait();
      }

      expect(
        await nftStakerContract.nftsOfStaker(accounts[DEFAULT_USER].address)
      ).to.be.eql([
        new BigNumber.from(1),
        new BigNumber.from(2),
        new BigNumber.from(3),
      ]);
    });
  });
});
